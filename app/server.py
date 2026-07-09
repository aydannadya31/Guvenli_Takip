"""Flask web sunucusu — tüm API rotalarını tanımlar."""
from flask import Flask, jsonify, request, render_template
from . import permissions
from .modules import camera, audio, location, storage

app = Flask(__name__, template_folder="../templates", static_folder="../static")


@app.route("/")
def index():
    """Ana sayfa — izin durumunu kontrol ederek yönlendirir."""
    return render_template("index.html")


@app.route("/api/permissions")
def api_permissions():
    """Tüm izinleri döndürür."""
    return jsonify({"permissions": permissions.get_all_permissions()})


@app.route("/api/permissions/grant", methods=["POST"])
def api_grant_permission():
    """Bir izni verir."""
    data = request.get_json()
    key = data.get("key")
    if key not in permissions.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    permissions.grant(key)
    return jsonify({"status": "ok", "key": key, "granted": True})


@app.route("/api/permissions/revoke", methods=["POST"])
def api_revoke_permission():
    """Bir izni iptal eder."""
    data = request.get_json()
    key = data.get("key")
    if key not in permissions.PERMISSION_DEFINITIONS:
        return jsonify({"error": "Geçersiz izin"}), 400
    permissions.revoke(key)
    return jsonify({"status": "ok", "key": key, "granted": False})


@app.route("/api/permissions/revoke-all", methods=["POST"])
def api_revoke_all():
    """Tüm izinleri iptal eder."""
    permissions.revoke_all()
    return jsonify({"status": "ok"})


@app.route("/api/scan/camera")
def api_scan_camera():
    """Kamera taraması yapar."""
    result = camera.scan_cameras()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)


@app.route("/api/scan/camera/capture")
def api_capture_camera():
    """Kameradan görüntü yakalar."""
    camera_id = request.args.get("id", 0)
    result = camera.capture_frame(camera_id)
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)


@app.route("/api/scan/audio")
def api_scan_audio():
    """Ses donanımını tarar."""
    result = audio.scan_audio()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)


@app.route("/api/scan/audio/record")
def api_record_audio():
    """Mikrofondan kayıt alır."""
    duration = request.args.get("duration", 2, type=int)
    duration = min(max(duration, 1), 5)
    result = audio.record_mic(duration=duration)
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)


@app.route("/api/scan/audio/test-speaker")
def api_test_speaker():
    """Hoparlör testi yapar."""
    result = audio.test_speaker()
    if "error" in result:
        return jsonify(result), 403 if "izin" in result.get("error", "") else 500
    return jsonify(result)


@app.route("/api/scan/location")
def api_location():
    """Konum bilgisini alır."""
    result = location.get_location()
    if "error" in result:
        return jsonify(result), 403 if result.get("status") == "blocked" else 500
    return jsonify(result)


@app.route("/api/scan/storage")
def api_storage():
    """Depolama ve sistem bilgilerini alır."""
    result = storage.get_storage_summary()
    return jsonify(result)


@app.route("/api/scan/all")
def api_scan_all():
    """Tüm modülleri tara — sadece izin verilenleri."""
    results = {}
    perms = permissions.load_permissions()

    if perms.get("camera"):
        results["camera"] = camera.scan_cameras()
    else:
        results["camera"] = {"status": "blocked"}

    if perms.get("microphone") or perms.get("speaker"):
        results["audio"] = audio.scan_audio()
    else:
        results["audio"] = {"status": "blocked"}

    if perms.get("location"):
        results["location"] = location.get_location()
    else:
        results["location"] = {"status": "blocked"}

    if perms.get("storage"):
        results["storage"] = storage.get_disk_info()
    else:
        results["storage"] = {"status": "blocked"}

    results["system"] = storage.get_system_info()
    results["permissions"] = permissions.get_all_permissions()

    return jsonify(results)
