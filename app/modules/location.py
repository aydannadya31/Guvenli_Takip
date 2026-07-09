"""Konum modülü — cross-platform (GPS mobil + IP desktop)."""
from ..platform import is_mobile

# Mobil GPS
_GPS_AVAILABLE = False
if is_mobile():
    try:
        from plyer import gps as _plyer_gps
        _GPS_AVAILABLE = True
    except Exception:
        pass

# Desktop: requests
import requests
from ..permissions import is_granted


def _get_gps_location():
    """Plyer GPS ile konum alır (mobil)."""
    if not _GPS_AVAILABLE:
        return None
    try:
        import threading
        result = {}

        def on_location(**kwargs):
            result.update(kwargs)

        def on_error(error):
            result["error"] = str(error)

        _plyer_gps.on_location = on_location
        _plyer_gps.on_error = on_error
        _plyer_gps.start(1000, 0)
        import time
        time.sleep(2)
        _plyer_gps.stop()
        if result:
            return {
                "status": "ok",
                "latitude": result.get("lat"),
                "longitude": result.get("lon"),
                "altitude": result.get("altitude"),
                "accuracy": result.get("accuracy"),
                "source": "gps",
            }
    except Exception:
        pass
    return None


def get_public_ip():
    """Genel IP adresini alır."""
    try:
        resp = requests.get("https://api.ipify.org?format=json", timeout=5)
        return resp.json().get("ip", "Bilinmiyor")
    except Exception:
        return "Alınamadı"


def _get_ip_location():
    """IP tabanlı konum (desktop fallback / mobil yedek)."""
    try:
        ip = get_public_ip()
        resp = requests.get(f"https://ipapi.co/{ip}/json/", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return {"status": "ok", "ip": ip, "country": data.get("country_name", "Bilinmiyor"), "country_code": data.get("country_code", ""), "region": data.get("region", "Bilinmiyor"), "city": data.get("city", "Bilinmiyor"), "latitude": data.get("latitude"), "longitude": data.get("longitude"), "timezone": data.get("timezone", "Bilinmiyor"), "isp": data.get("org", "Bilinmiyor"), "source": "ip"}
        # Yedek: ip-api.com
        resp2 = requests.get(f"http://ip-api.com/json/{ip}", timeout=5)
        if resp2.status_code == 200:
            d2 = resp2.json()
            return {"status": "ok", "ip": ip, "country": d2.get("country", "Bilinmiyor"), "country_code": d2.get("countryCode", ""), "region": d2.get("regionName", "Bilinmiyor"), "city": d2.get("city", "Bilinmiyor"), "latitude": d2.get("lat"), "longitude": d2.get("lon"), "timezone": d2.get("timezone", "Bilinmiyor"), "isp": d2.get("isp", "Bilinmiyor"), "source": "ip-fallback"}
        return {"status": "error", "error": "Konum bilgisi alınamadı"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_location():
    """Mobil: GPS ana konum + IP destek. Desktop: IP tabanlı."""
    if not is_granted("location"):
        return {"error": "Konum izni verilmedi", "status": "blocked"}
    try:
        primary = None
        ip_data = _get_ip_location()

        if is_mobile():
            gps_result = _get_gps_location()
            if gps_result and gps_result.get("status") == "ok":
                primary = gps_result
                if ip_data and ip_data.get("status") == "ok":
                    primary["ip_support"] = {
                        "ip": ip_data.get("ip"),
                        "country": ip_data.get("country"),
                        "country_code": ip_data.get("country_code"),
                        "region": ip_data.get("region"),
                        "city": ip_data.get("city"),
                        "timezone": ip_data.get("timezone"),
                        "isp": ip_data.get("isp"),
                    }
                return primary

        if ip_data and ip_data.get("status") == "ok":
            return ip_data

        return {"status": "error", "error": "Konum bilgisi alınamadı"}
    except Exception as e:
        return {"status": "error", "error": str(e)}
