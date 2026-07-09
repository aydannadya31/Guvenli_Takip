"""Depolama modülü — cross-platform (mobil storage + desktop psutil)."""
from ..platform import is_mobile

# Mobil storage
_STORAGEPATH_AVAILABLE = False
if is_mobile():
    try:
        from plyer import storagepath
        _STORAGEPATH_AVAILABLE = True
    except Exception:
        pass

# Desktop storage
_PSUTIL_AVAILABLE = False
if not is_mobile():
    try:
        import psutil
        import platform as _platform
        import os as _os
        _PSUTIL_AVAILABLE = True
    except ImportError:
        pass

from ..permissions import is_granted


def _get_mobile_storage():
    """Mobil depolama bilgisi — Plyer storagepath ile."""
    try:
        info = {"status": "ok", "disks": []}
        if _STORAGEPATH_AVAILABLE:
            app_dir = storagepath.get_app_dir()
            info["app_dir"] = app_dir
        return info
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _get_desktop_disks():
    """Desktop disk bilgileri — psutil ile."""
    if not _PSUTIL_AVAILABLE:
        return []
    disks = []
    for part in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(part.mountpoint)
            is_removable = _is_removable(part.device)
            disks.append({
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total_gb": round(usage.total / (1024 ** 3), 2),
                "used_gb": round(usage.used / (1024 ** 3), 2),
                "free_gb": round(usage.free / (1024 ** 3), 2),
                "percent_used": usage.percent,
                "type": "Harici" if is_removable else "Dahili",
            })
        except (PermissionError, OSError):
            continue
    return disks


def _is_removable(device_path):
    """Çıkarılabilir disk kontrolü (Windows)."""
    if _platform.system() == "Windows":
        try:
            dp = device_path.rstrip("\\")
            if not dp:
                return False
            import ctypes
            drive = f"{dp[0].upper()}:\\"
            return ctypes.windll.kernel32.GetDriveTypeW(drive) == 2
        except Exception:
            pass
    return False


def get_disk_info():
    """Depolama bilgilerini döndürür."""
    if not is_granted("storage"):
        return {"error": "Depolama izni verilmedi", "status": "blocked"}
    try:
        if is_mobile():
            return _get_mobile_storage()
        disks = _get_desktop_disks()
        return {"status": "ok", "disk_count": len(disks), "disks": disks}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_system_info():
    """Sistem bilgilerini döndürür (cross-platform)."""
    try:
        import platform
        uname = platform.uname()
        info = {"status": "ok", "system": uname.system, "hostname": uname.node, "processor": uname.processor, "architecture": uname.machine}
        if _PSUTIL_AVAILABLE:
            info["ram_total_gb"] = round(psutil.virtual_memory().total / (1024 ** 3), 2)
            info["ram_available_gb"] = round(psutil.virtual_memory().available / (1024 ** 3), 2)
            info["ram_percent_used"] = psutil.virtual_memory().percent
        return info
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_storage_summary():
    """Depolama özeti (izin yoksa bile sistem bilgisi)."""
    storage_info = get_disk_info() if is_granted("storage") else {"status": "blocked"}
    return {"storage": storage_info, "system": get_system_info()}
