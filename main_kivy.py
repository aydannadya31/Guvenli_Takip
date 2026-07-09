# SecurityMonitor — Kivy Native Mobile App
# Cihaz donanim bileşenlerine erişen güvenlik uygulamasi (Mobil surum)

import os
import sys
import json
import threading

# Proje kokunu path'e ekle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.platform import is_mobile, ANDROID
from app.permissions import load_permissions, grant, revoke, revoke_all, get_all_permissions, PERMISSION_DEFINITIONS
from app.modules import camera as cam_module, audio as audio_module, location as loc_module, storage as storage_module

from kivy.config import Config
Config.set("kivy", "log_level", "warning")
Config.set("kivy", "exit_on_escape", "1")

from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.gridlayout import GridLayout
from kivy.uix.scrollview import ScrollView
from kivy.uix.label import Label
from kivy.uix.button import Button
from kivy.uix.switch import Switch
from kivy.uix.image import Image
from kivy.uix.popup import Popup
from kivy.uix.progressbar import ProgressBar
from kivy.uix.screenmanager import ScreenManager, Screen
from kivy.clock import Clock
from kivy.graphics import Color, RoundedRectangle
from kivy.utils import platform as kivy_platform


# ============ RENKLER (Material Dark) ============
BG_DARK = (0.04, 0.05, 0.09, 1)
BG_CARD = (0.10, 0.14, 0.20, 1)
BG_INPUT = (0.06, 0.09, 0.16, 1)
BORDER = (0.16, 0.23, 0.32, 1)
TEXT_PRIMARY = (0.91, 0.93, 0.96, 1)
TEXT_SECONDARY = (0.58, 0.64, 0.72, 1)
ACCENT_BLUE = (0.23, 0.51, 0.96, 1)
ACCENT_GREEN = (0.13, 0.77, 0.37, 1)
ACCENT_RED = (0.94, 0.27, 0.27, 1)
ACCENT_YELLOW = (0.92, 0.70, 0.03, 1)
ACCENT_CYAN = (0.02, 0.71, 0.83, 1)


def make_button(text, on_press=None, color=ACCENT_BLUE, size_hint=(1, None), height=48):
    btn = Button(
        text=text,
        size_hint=size_hint,
        height=height,
        background_normal="",
        background_color=color,
        color=TEXT_PRIMARY,
        bold=True,
    )
    if on_press:
        btn.bind(on_press=on_press)
    return btn


def make_card(title, content_widget):
    """Kart goruntulu bir BoxLayout dondurur."""
    card = BoxLayout(orientation="vertical", size_hint=(1, None), padding=12, spacing=8)
    card.bind(minimum_height=card.setter("height"))
    with card.canvas.before:
        Color(*BG_CARD)
        RoundedRectangle(pos=card.pos, size=card.size, radius=[8])
    card.bind(pos=lambda _, v: card.canvas.before.invalidate())
    card.bind(size=lambda _, s: card.canvas.before.invalidate())

    title_label = Label(
        text=title,
        size_hint=(1, None),
        height=30,
        color=TEXT_PRIMARY,
        bold=True,
        halign="left",
        valign="middle",
    )
    title_label.bind(size=title_label.setter("text_size"))
    card.add_widget(title_label)
    card.add_widget(content_widget)
    return card


def make_info_row(label, value, value_color=TEXT_PRIMARY):
    row = BoxLayout(orientation="horizontal", size_hint=(1, None), height=28)
    lbl = Label(text=label, size_hint=(0.5, 1), color=TEXT_SECONDARY, halign="left", valign="middle")
    lbl.bind(size=lbl.setter("text_size"))
    val = Label(text=str(value), size_hint=(0.5, 1), color=value_color, halign="right", valign="middle", bold=True)
    val.bind(size=val.setter("text_size"))
    row.add_widget(lbl)
    row.add_widget(val)
    return row


# ============ PERMISSION GATE SCREEN ============
class PermissionGateScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "gate"
        self.perms = {}
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=24, spacing=12)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        scroll.add_widget(layout)
        self.add_widget(scroll)

        # Baslik
        title = Label(
            text="[b]SecurityMonitor[/b]",
            size_hint=(1, None),
            height=50,
            markup=True,
            color=ACCENT_CYAN,
            font_size=22,
        )
        layout.add_widget(title)
        subtitle = Label(
            text="Guvenlik Takip ve Donanim Izleme",
            size_hint=(1, None),
            height=30,
            color=TEXT_SECONDARY,
        )
        layout.add_widget(subtitle)

        info = Label(
            text="Bu uygulama donanim bileşenlerinize erişim ister.\nHer izni yönetebilirsiniz.",
            size_hint=(1, None),
            height=50,
            color=TEXT_SECONDARY,
            font_size=13,
        )
        layout.add_widget(info)

        self.perm_widgets = {}
        for key, defn in PERMISSION_DEFINITIONS.items():
            row = BoxLayout(orientation="horizontal", size_hint=(1, None), height=50, spacing=8)
            with row.canvas.before:
                Color(*BG_CARD)
                RoundedRectangle(pos=row.pos, size=row.size, radius=[6])
            row.bind(pos=lambda _, v: row.canvas.before.invalidate())
            row.bind(size=lambda _, s: row.canvas.before.invalidate())

            info_col = BoxLayout(orientation="vertical", size_hint=(0.7, 1))
            lbl = Label(text=defn["label"], color=TEXT_PRIMARY, bold=True, halign="left", valign="bottom", font_size=14)
            lbl.bind(size=lbl.setter("text_size"))
            desc = Label(text=defn["description"], color=TEXT_SECONDARY, halign="left", valign="top", font_size=11)
            desc.bind(size=desc.setter("text_size"))
            info_col.add_widget(lbl)
            info_col.add_widget(desc)

            switch = Switch(active=False, size_hint=(0.3, None), height=40)
            switch.bind(active=lambda _, v, k=key: self.toggle_perm(k, v))

            row.add_widget(info_col)
            row.add_widget(switch)
            self.perm_widgets[key] = switch
            layout.add_widget(row)

        layout.add_widget(Label(size_hint=(1, None), height=10))

        # Butonlar
        start_btn = make_button("Secilen Izinleri Ver ve Basla", self.on_start, ACCENT_BLUE, height=52)
        layout.add_widget(start_btn)

        skip_btn = make_button("Tumunu Reddet", self.on_skip, (0.3, 0.3, 0.3, 1), height=44)
        layout.add_widget(skip_btn)

    def toggle_perm(self, key, active):
        self.perms[key] = active

    def on_start(self, _):
        for key, active in self.perms.items():
            if active:
                grant(key)
        self.manager.current = "dashboard"

    def on_skip(self, _):
        revoke_all()
        self.manager.current = "dashboard"


# ============ DASHBOARD SCREEN ============
class DashboardScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "dashboard"
        self.status_labels = {}
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=8, padding=4)
        content.bind(minimum_height=content.setter("height"))

        # Baslik
        header = BoxLayout(orientation="horizontal", size_hint=(1, None), height=50)
        title = Label(
            text="[b]SecurityMonitor[/b]",
            markup=True,
            color=ACCENT_CYAN,
            font_size=20,
            halign="left",
        )
        title.bind(size=title.setter("text_size"))
        refresh_btn = make_button("TARA", self.on_refresh, ACCENT_BLUE, size_hint=(0.3, None), height=40)
        header.add_widget(title)
        header.add_widget(refresh_btn)
        content.add_widget(header)

        # Modul kartlari
        self.grid = GridLayout(cols=2, size_hint=(1, None), spacing=8, padding=0)
        self.grid.bind(minimum_height=self.grid.setter("height"))

        modules = [
            ("camera", "Kamera", "📷"),
            ("audio", "Ses", "🎙️"),
            ("location", "Konum", "📍"),
            ("storage", "Depolama", "💾"),
            ("system", "Sistem", "🖥️"),
        ]
        self.module_cards = {}
        for key, label, icon in modules:
            card = BoxLayout(orientation="vertical", size_hint=(None, None), size=(150, 100), padding=8, spacing=4)
            with card.canvas.before:
                Color(*BG_CARD)
                RoundedRectangle(pos=card.pos, size=card.size, radius=[8])
            card.bind(pos=lambda _, v: card.canvas.before.invalidate())
            card.bind(size=lambda _, s: card.canvas.before.invalidate())

            icon_lbl = Label(text=icon, font_size=28, size_hint=(1, 0.4))
            name_lbl = Label(text=label, color=TEXT_PRIMARY, bold=True, size_hint=(1, 0.3))
            status_lbl = Label(text="...", color=TEXT_SECONDARY, font_size=11, size_hint=(1, 0.3))

            card.add_widget(icon_lbl)
            card.add_widget(name_lbl)
            card.add_widget(status_lbl)
            self.module_cards[key] = {"card": card, "status": status_lbl}
            self.grid.add_widget(card)

        content.add_widget(self.grid)
        scroll.add_widget(content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_enter(self):
        Clock.schedule_once(lambda dt: self.on_refresh(None), 0.5)

    def on_refresh(self, _):
        self.refresh_all()

    def refresh_all(self):
        Clock.schedule_once(lambda dt: self._do_refresh())

    def _do_refresh(self):
        import requests
        perms = load_permissions()

        for module_key, card_data in self.module_cards.items():
            status_lbl = card_data["status"]
            granted = perms.get(module_key, False) if module_key != "system" else True

            if not granted:
                status_lbl.text = "🔒 Izin yok"
                status_lbl.color = ACCENT_RED
                continue

            status_lbl.text = "🔍 Taranıyor..."
            status_lbl.color = ACCENT_YELLOW

        # Gerçek tarama (arka planda)
        def scan():
            results = {}
            try:
                if perms.get("camera"):
                    r = cam_module.scan_cameras()
                    results["camera"] = r.get("camera_count", 0) if r.get("status") == "ok" else "Hata"
                if perms.get("microphone") or perms.get("speaker"):
                    r = audio_module.scan_audio()
                    results["audio"] = f"{r.get('microphone_count',0)} mic / {r.get('speaker_count',0)} hop"
                if perms.get("location"):
                    r = loc_module.get_location()
                    results["location"] = r.get("city", "Hata") if r.get("status") == "ok" else "Hata"
                if perms.get("storage"):
                    r = storage_module.get_disk_info()
                    results["storage"] = f"{r.get('disk_count',0)} disk" if r.get("status") == "ok" else "Hata"
                results["system"] = "Hazır"
            except Exception as e:
                results["error"] = str(e)

            Clock.schedule_once(lambda dt: self._update_results(perms, results))

        threading.Thread(target=scan, daemon=True).start()

    def _update_results(self, perms, results):
        for module_key, card_data in self.module_cards.items():
            status_lbl = card_data["status"]
            if module_key == "system":
                status_lbl.text = "✅ Hazır"
                status_lbl.color = ACCENT_GREEN
                continue

            if not perms.get(module_key, False):
                continue

            val = results.get(module_key, "Hata")
            if val and "Hata" not in str(val):
                status_lbl.text = f"✅ {val}"
                status_lbl.color = ACCENT_GREEN
            else:
                status_lbl.text = "❌ Hata"
                status_lbl.color = ACCENT_RED


# ============ MODULE SCREENS ============
class CameraScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "camera"
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        self.content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=8)
        self.content.bind(minimum_height=self.content.setter("height"))

        header = Label(text="[b]📷 Kamera[/b]", markup=True, size_hint=(1, None), height=40, color=TEXT_PRIMARY, font_size=18)
        self.content.add_widget(header)

        scan_btn = make_button("Kameralari Tara", self.on_scan)
        self.content.add_widget(scan_btn)

        self.result_box = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=4)
        self.result_box.bind(minimum_height=self.result_box.setter("height"))
        self.content.add_widget(self.result_box)

        scroll.add_widget(self.content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_scan(self, _):
        self.result_box.clear_widgets()
        if not load_permissions().get("camera"):
            self.result_box.add_widget(Label(text="🔒 Kamera izni yok", color=ACCENT_RED, size_hint=(1, None), height=40))
            return
        threading.Thread(target=self._do_scan, daemon=True).start()

    def _do_scan(self):
        try:
            data = cam_module.scan_cameras()
            Clock.schedule_once(lambda dt: self._show_results(data))
        except Exception as e:
            Clock.schedule_once(lambda dt: self.result_box.add_widget(
                Label(text=f"Hata: {e}", color=ACCENT_RED, size_hint=(1, None), height=40))
            )

    def _show_results(self, data):
        self.result_box.clear_widgets()
        if data.get("status") == "ok":
            self.result_box.add_widget(
                make_info_row("Kamera Sayisi", data.get("camera_count", 0), ACCENT_GREEN)
            )
            cap_btn = make_button("Goruntu Yakala", self.on_capture, ACCENT_CYAN, height=44)
            self.result_box.add_widget(cap_btn)
            self.image_area = BoxLayout(orientation="vertical", size_hint=(1, None), height=200)
            self.result_box.add_widget(self.image_area)
        else:
            self.result_box.add_widget(
                Label(text=f"❌ {data.get('error','Bilinmeyen hata')}", color=ACCENT_RED, size_hint=(1, None), height=40)
            )

    def on_capture(self, _):
        if not hasattr(self, "image_area"):
            return
        self.image_area.clear_widgets()
        self.image_area.add_widget(Label(text="Fotograf cekiliyor...", color=TEXT_SECONDARY, size_hint=(1, None), height=40))
        threading.Thread(target=self._do_capture, daemon=True).start()

    def _do_capture(self):
        try:
            data = cam_module.capture_frame(0)
            Clock.schedule_once(lambda dt: self._show_capture(data))
        except Exception as e:
            Clock.schedule_once(lambda dt: self.image_area.clear_widgets())

    def _show_capture(self, data):
        self.image_area.clear_widgets()
        if data.get("status") == "ok":
            # Kivy Image ile gostermek icin base64 -> temp file
            import tempfile, base64
            img_data = base64.b64decode(data["image"])
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.write(img_data)
            tmp.close()
            img = Image(source=tmp.name, size_hint=(1, None), height=200)
            self.image_area.add_widget(img)
        else:
            self.image_area.add_widget(
                Label(text=f"❌ {data.get('error','Hata')}", color=ACCENT_RED, size_hint=(1, None), height=40)
            )


class AudioScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "audio"
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        self.content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=8)
        self.content.bind(minimum_height=self.content.setter("height"))

        header = Label(text="[b]🎙️ Ses[/b]", markup=True, size_hint=(1, None), height=40, color=TEXT_PRIMARY, font_size=18)
        self.content.add_widget(header)
        scan_btn = make_button("Sesi Tara", self.on_scan)
        self.content.add_widget(scan_btn)

        self.result = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=4)
        self.result.bind(minimum_height=self.result.setter("height"))
        self.content.add_widget(self.result)

        scroll.add_widget(self.content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_scan(self, _):
        self.result.clear_widgets()
        if not load_permissions().get("microphone") and not load_permissions().get("speaker"):
            self.result.add_widget(Label(text="🔒 Ses izni yok", color=ACCENT_RED, size_hint=(1, None), height=40))
            return
        data = audio_module.scan_audio()
        self.result.clear_widgets()
        if data.get("status") == "ok":
            self.result.add_widget(make_info_row("Mikrofon", data.get("microphone_count", 0), ACCENT_GREEN))
            self.result.add_widget(make_info_row("Hoparlor", data.get("speaker_count", 0), ACCENT_GREEN))
            rec_btn = make_button("Kayit Al (2sn)", self.on_record, ACCENT_CYAN, height=44)
            self.result.add_widget(rec_btn)
            self.rec_result = Label(text="", size_hint=(1, None), height=30)
            self.result.add_widget(self.rec_result)

    def on_record(self, _):
        self.rec_result.text = "Kayit aliniyor..."
        threading.Thread(target=self._do_record, daemon=True).start()

    def _do_record(self):
        try:
            data = audio_module.record_mic(2)
            if data.get("status") == "ok":
                Clock.schedule_once(lambda dt: setattr(self.rec_result, "text", f"Ses: %{data.get('level',0)} | Sinyal: {'Var' if data.get('has_signal') else 'Yok'}"))
            else:
                Clock.schedule_once(lambda dt: setattr(self.rec_result, "text", f"Hata: {data.get('error','')}"))
        except Exception:
            pass


class LocationScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "location"
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        self.content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=8)
        self.content.bind(minimum_height=self.content.setter("height"))

        header = Label(text="[b]📍 Konum[/b]", markup=True, size_hint=(1, None), height=40, color=TEXT_PRIMARY, font_size=18)
        self.content.add_widget(header)
        scan_btn = make_button("Konumu Sorgula", self.on_scan)
        self.content.add_widget(scan_btn)

        self.result = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=4)
        self.result.bind(minimum_height=self.result.setter("height"))
        self.content.add_widget(self.result)

        scroll.add_widget(self.content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_scan(self, _):
        self.result.clear_widgets()
        if not load_permissions().get("location"):
            self.result.add_widget(Label(text="🔒 Konum izni yok", color=ACCENT_RED, size_hint=(1, None), height=40))
            return
        self.result.add_widget(Label(text="Konum aliniyor...", color=TEXT_SECONDARY, size_hint=(1, None), height=30))
        threading.Thread(target=self._do_scan, daemon=True).start()

    def _do_scan(self):
        try:
            data = loc_module.get_location()
            Clock.schedule_once(lambda dt: self._show(data))
        except Exception as e:
            Clock.schedule_once(lambda dt: self._error(str(e)))

    def _show(self, data):
        self.result.clear_widgets()
        if data.get("status") != "ok":
            self.result.add_widget(Label(text=f"❌ {data.get('error','Hata')}", color=ACCENT_RED, size_hint=(1, None), height=40))
            return

        if data.get("source") == "gps":
            self.result.add_widget(Label(text="[b]📍 GPS Konumu (Ana)[/b]", markup=True, size_hint=(1, None), height=30, color=ACCENT_GREEN))
            gps_fields = [
                ("Enlem", str(data.get("latitude", ""))),
                ("Boylam", str(data.get("longitude", ""))),
                ("Irtifa", f"{data.get('altitude', 0)} m"),
                ("Dogruluk", f"{data.get('accuracy', '-')} m"),
            ]
            for label, val in gps_fields:
                self.result.add_widget(make_info_row(label, val, ACCENT_GREEN))

            ip_sup = data.get("ip_support")
            if ip_sup:
                self.result.add_widget(Label(text="[b]🌐 IP Destek[/b]", markup=True, size_hint=(1, None), height=30, color=TEXT_SECONDARY))
                ip_fields = [
                    ("IP", ip_sup.get("ip", "-")),
                    ("Ulke", f"{ip_sup.get('country', '-')} {ip_sup.get('country_code', '')}"),
                    ("Sehir", ip_sup.get("city", "-")),
                    ("ISP", ip_sup.get("isp", "-")),
                ]
                for label, val in ip_fields:
                    self.result.add_widget(make_info_row(label, val, TEXT_SECONDARY))
        else:
            fields = [
                ("IP", data.get("ip", "-")),
                ("Ulke", data.get("country", "-")),
                ("Sehir", data.get("city", "-")),
                ("Bolge", data.get("region", "-")),
                ("Enlem", str(data.get("latitude", ""))),
                ("Boylam", str(data.get("longitude", ""))),
                ("Kaynak", data.get("source", "-")),
                ("ISP", data.get("isp", "-")),
            ]
            for label, val in fields:
                self.result.add_widget(make_info_row(label, val, ACCENT_CYAN))

    def _error(self, msg):
        self.result.clear_widgets()
        self.result.add_widget(Label(text=f"❌ {msg}", color=ACCENT_RED, size_hint=(1, None), height=40))


class StorageScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "storage"
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        self.content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=8)
        self.content.bind(minimum_height=self.content.setter("height"))

        header = Label(text="[b]💾 Depolama[/b]", markup=True, size_hint=(1, None), height=40, color=TEXT_PRIMARY, font_size=18)
        self.content.add_widget(header)
        scan_btn = make_button("Depolamayi Tara", self.on_scan)
        self.content.add_widget(scan_btn)

        self.result = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=4)
        self.result.bind(minimum_height=self.result.setter("height"))
        self.content.add_widget(self.result)

        scroll.add_widget(self.content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_scan(self, _):
        self.result.clear_widgets()
        self.result.add_widget(Label(text="Taranıyor...", color=TEXT_SECONDARY, size_hint=(1, None), height=30))
        threading.Thread(target=self._do_scan, daemon=True).start()

    def _do_scan(self):
        try:
            data = storage_module.get_storage_summary()
            Clock.schedule_once(lambda dt: self._show(data))
        except Exception as e:
            Clock.schedule_once(lambda dt: self._error(str(e)))

    def _show(self, data):
        self.result.clear_widgets()
        # Sistem bilgisi
        sys_info = data.get("system", {})
        if sys_info.get("status") == "ok":
            self.result.add_widget(Label(text="[b]Sistem[/b]", markup=True, size_hint=(1, None), height=30, color=ACCENT_CYAN))
            fields = [
                ("Isletim Sistemi", sys_info.get("system", "-")),
                ("Cihaz", sys_info.get("hostname", "-")),
                ("RAM", f"{sys_info.get('ram_total_gb',0)} GB"),
            ]
            for label, val in fields:
                self.result.add_widget(make_info_row(label, val, TEXT_PRIMARY))

        # Depolama
        storage_info = data.get("storage", {})
        if storage_info.get("status") == "blocked":
            self.result.add_widget(Label(text="🔒 Depolama izni yok", color=ACCENT_RED, size_hint=(1, None), height=40))
        elif storage_info.get("status") == "ok":
            self.result.add_widget(Label(text="[b]Diskler[/b]", markup=True, size_hint=(1, None), height=30, color=ACCENT_CYAN))
            for disk in storage_info.get("disks", []):
                self.result.add_widget(
                    make_info_row(disk.get("device", "-"), f"{disk.get('used_gb',0)} / {disk.get('total_gb',0)} GB", ACCENT_GREEN)
                )
                progress = ProgressBar(max=100, value=disk.get("percent_used", 0), size_hint=(1, None), height=10)
                self.result.add_widget(progress)

    def _error(self, msg):
        self.result.clear_widgets()
        self.result.add_widget(Label(text=f"❌ {msg}", color=ACCENT_RED, size_hint=(1, None), height=40))


# ============ PERMISSIONS SCREEN ============
class PermissionsScreen(Screen):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.name = "permissions"
        self.build_ui()

    def build_ui(self):
        layout = BoxLayout(orientation="vertical", padding=12, spacing=8)
        with layout.canvas.before:
            Color(*BG_DARK)
            RoundedRectangle(pos=layout.pos, size=layout.size)
        layout.bind(pos=lambda _, v: layout.canvas.before.invalidate())
        layout.bind(size=lambda _, s: layout.canvas.before.invalidate())

        scroll = ScrollView()
        self.content = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=6)
        self.content.bind(minimum_height=self.content.setter("height"))

        header = Label(text="[b]🔐 Izin Yonetimi[/b]", markup=True, size_hint=(1, None), height=40, color=TEXT_PRIMARY, font_size=18)
        self.content.add_widget(header)

        revoke_btn = make_button("Tumunu Iptal Et", self.on_revoke_all, ACCENT_RED, height=44)
        self.content.add_widget(revoke_btn)

        self.perm_list = BoxLayout(orientation="vertical", size_hint=(1, None), spacing=4)
        self.perm_list.bind(minimum_height=self.perm_list.setter("height"))
        self.content.add_widget(self.perm_list)

        scroll.add_widget(self.content)
        layout.add_widget(scroll)
        self.add_widget(layout)

    def on_enter(self):
        self.refresh()

    def refresh(self):
        self.perm_list.clear_widgets()
        perms = get_all_permissions()
        for p in perms:
            row = BoxLayout(orientation="horizontal", size_hint=(1, None), height=50, spacing=8)
            with row.canvas.before:
                Color(*BG_CARD)
                RoundedRectangle(pos=row.pos, size=row.size, radius=[6])
            row.bind(pos=lambda _, v: row.canvas.before.invalidate())
            row.bind(size=lambda _, s: row.canvas.before.invalidate())

            info = Label(
                text=f"[b]{p['label']}[/b]\n{p['description']}",
                markup=True,
                size_hint=(0.7, 1),
                color=TEXT_PRIMARY,
                font_size=12,
                halign="left",
                valign="middle",
            )
            info.bind(size=info.setter("text_size"))

            sw = Switch(active=p["granted"], size_hint=(0.3, None), height=40)
            sw.bind(active=lambda _, v, k=p["key"]: self.on_toggle(k, v))

            row.add_widget(info)
            row.add_widget(sw)
            self.perm_list.add_widget(row)

    def on_toggle(self, key, active):
        if active:
            grant(key)
        else:
            revoke(key)

    def on_revoke_all(self, _):
        revoke_all()
        self.refresh()


# ============ ANA UYGULAMA ============
class SecurityMonitorApp(App):
    def build(self):
        self.title = "SecurityMonitor"
        sm = ScreenManager()
        sm.add_widget(PermissionGateScreen())
        sm.add_widget(DashboardScreen())
        sm.add_widget(CameraScreen())
        sm.add_widget(AudioScreen())
        sm.add_widget(LocationScreen())
        sm.add_widget(StorageScreen())
        sm.add_widget(PermissionsScreen())
        sm.current = "gate"
        return sm

    def on_start(self):
        """Flask sunucusunu arka planda baslat (mobilde degilse)."""
        if not is_mobile():
            try:
                from app.server import app
                import threading
                t = threading.Thread(
                    target=lambda: app.run(host="127.0.0.1", port=5050, debug=False, use_reloader=False),
                    daemon=True,
                )
                t.start()
            except Exception:
                pass


if __name__ == "__main__":
    SecurityMonitorApp().run()
