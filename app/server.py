"""Flask web sunucusu — cloud ve lokal modda çalışır.
   Cloud modda sadece IP konum + frontend servis eder.
   Lokal modda Python donanım modüllerine de erişir."""
import os
import hashlib
from flask import Flask, jsonify, request, render_template
from . import permissions

IS_CLOUD = os.environ.get("DEPLOY_MODE") == "cloud"

app = Flask(__name__, template_folder="../templates", static_folder="../static")

# Basit admin şifresi (gerçek uygulamada .env'den okunur)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Ag1453ag!")
ADMIN_PASSWORD_HASH = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()


# ==================== AUTH ====================

@app.route("/login")
def login_page():
    """Giriş sayfası."""
    return render_template("login.html")


@app.route("/app")
def app_page():
    """Ana uygulama (auth gerekir, frontend halleder)."""
    return render_template("index.html")


@app.route("/api/auth/admin", methods=["POST"])
def api_admin_auth():
    """Admin şifresi doğrulama."""
    data = request.get_json() or {}
    given = data.get("password", "")
    given_hash = hashlib.sha256(given.encode()).hexdigest()

    if given_hash == ADMIN_PASSWORD_HASH:
        return jsonify({"status": "ok", "role": "admin"})
    return jsonify({"status": "error", "error": "Hatalı şifre"}), 401


# ==================== PERMISSIONS ====================

@app.route("/api/permissions")
def api_permissions():
    """Tüm izinleri döndürür."""
    return jsonify({"permissions": permissions.get_all_permissions()})


@app.route("/api/permissions/grant", methods=["POST"])
def api_grant_permission():
    data = request.get_json()
    key = data.get("key")
    if key not in permissions.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    permissions.grant(key)
    return jsonify({"status": "ok", "key": key, "granted": True})


@app.route("/api/permissions/revoke", methods=["POST"])
def api_revoke_permission():
    data = request.get_json()
    key = data.get("key")
    if key not in permissions.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    permissions.revoke(key)
    return jsonify({"status": "ok", "key": key, "granted": False})


@app.route("/api/permissions/revoke-all", methods=["POST"])
def api_revoke_all():
    permissions.revoke_all()
    return jsonify({"status": "ok"})


# ==================== IP KONUM API ====================

@app.route("/api/ip-location")
def api_ip_location():
    """İstemcinin IP adresinden konum bilgisi alır."""
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

        return jsonify({
            "status": "ok", "source": "ip", "ip": data.get("query"),
            "country": data.get("country"), "country_code": data.get("countryCode"),
            "region": data.get("region"), "city": data.get("city"),
            "postal": data.get("zip"), "latitude": data.get("lat"),
            "longitude": data.get("lon"), "isp": data.get("isp"),
            "org": data.get("org"), "timezone": data.get("timezone"),
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)})


# ==================== ANA SAYFA (YÖNLENDİRME) ====================

@app.route("/")
def index():
    """Ana sayfa — login'e yönlendirir."""
    return render_template("login.html")


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
    """Tüm modülleri tara — cloud'da sadece sunucu tarafı veriler."""
    results = {}

    if IS_CLOUD:
        results["camera"] = {"status": "cloud"}
        results["audio"] = {"status": "cloud"}
        results["location"] = {"status": "cloud"}
        results["storage"] = {"status": "cloud"}
        results["system"] = {"status": "ok", "version": "1.0", "mode": "cloud"}
    else:
        perms = permissions.load_permissions()
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

    results["permissions"] = permissions.get_all_permissions()
    return jsonify(results)
