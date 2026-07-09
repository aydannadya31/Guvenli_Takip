"""Kamera modülü — cross-platform (Plyer mobil + OpenCV desktop)."""
from ..platform import is_mobile, ANDROID

# Mobil: Plyer
if is_mobile():
    _PLYER_AVAILABLE = False
    try:
        from plyer import camera as _plyer_cam
        _PLYER_AVAILABLE = True
    except Exception:
        pass
# Desktop: OpenCV
else:
    _CV2_AVAILABLE = False
    try:
        import cv2
        import base64
        import time as _time
        _CV2_AVAILABLE = True
    except ImportError:
        pass

from ..permissions import is_granted


def _list_cameras_mobile():
    """Mobilde kullanılabilir kameraları listeler."""
    if ANDROID:
        try:
            from android.api import JNI  # type: ignore
            context = JNI.get_context()
            camera_manager = context.getSystemService("camera")
            cam_count = camera_manager.getNumberOfCameras()
            cameras = []
            for i in range(cam_count):
                info = camera_manager.getCameraCharacteristics(i)
                facing = info.get(  # noqa
                    "android.camera.characteristics.lens.facing"
                )
                label = "Ön Kamera" if facing == 0 else "Arka Kamera"
                cameras.append({"id": i, "label": label})
            return cameras
        except Exception:
            pass
    # Plyer fallback
    if _PLYER_AVAILABLE:
        return [{"id": 0, "label": "Kamera"}]
    return []


def _list_cameras_desktop(max_test=5):
    """Desktopta kullanılabilir kameraları bulur."""
    if not _CV2_AVAILABLE:
        return []
    available = []
    for i in range(max_test):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                available.append({
                    "id": i,
                    "label": f"Kamera {len(available) + 1}",
                })
            cap.release()
    return available


def scan_cameras():
    """Kamera durumunu tarar ve sonuç döndürür."""
    if not is_granted("camera"):
        return {"error": "Kamera izni verilmedi", "status": "blocked"}
    try:
        if is_mobile():
            cameras = _list_cameras_mobile()
        else:
            cameras = _list_cameras_desktop()
        return {"status": "ok", "camera_count": len(cameras), "cameras": cameras}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def capture_frame(camera_id=0):
    """Kameradan görüntü yakalar."""
    if not is_granted("camera"):
        return {"error": "Kamera izni verilmedi"}
    try:
        if is_mobile():
            return _capture_frame_mobile(int(camera_id))
        else:
            return _capture_frame_desktop(int(camera_id))
    except Exception as e:
        return {"error": str(e)}


def _capture_frame_mobile(camera_id=0):
    """Mobilde Plyer ile fotoğraf çeker."""
    if not _PLYER_AVAILABLE:
        return {"error": "Kamera modülü mobilde kullanılamıyor"}
    try:
        import tempfile, base64
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()
        _plyer_cam.take_picture(tmp.name, None)
        with open(tmp.name, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")
        os.unlink(tmp.name)
        return {"status": "ok", "image": img_b64, "camera_id": camera_id}
    except Exception as e:
        return {"error": str(e)}


def _capture_frame_desktop(camera_id=0):
    """Desktopta OpenCV ile kare yakalar."""
    if not _CV2_AVAILABLE:
        return {"error": "OpenCV kullanılamıyor"}
    import cv2, base64, time
    cap = cv2.VideoCapture(int(camera_id), cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    if not cap.isOpened():
        return {"error": "Kamera açılamadı"}
    time.sleep(0.3)
    ret, frame = cap.read()
    cap.release()
    if not ret or frame is None:
        return {"error": "Görüntü alınamadı"}
    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    img_b64 = base64.b64encode(buffer).decode("utf-8")
    return {"status": "ok", "image": img_b64, "camera_id": camera_id}
