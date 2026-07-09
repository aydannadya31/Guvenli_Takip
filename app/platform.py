"""Platform tespiti ve cross-platform yardımcıları."""
import sys
import os
import platform as _platform

# Platform tipleri
MOBILE = False
ANDROID = False
IOS = False
WINDOWS = False
LINUX = False
MACOS = False

# Android tespiti
if hasattr(sys, "getandroidapilevel"):
    ANDROID = True
    MOBILE = True
elif _platform.system() == "Darwin" and "iPad" in _platform.machine():
    IOS = True
    MOBILE = True
elif _platform.system() == "Windows":
    WINDOWS = True
elif _platform.system() == "Linux":
    LINUX = True
elif _platform.system() == "Darwin":
    MACOS = True


def is_mobile() -> bool:
    """Mobil platformda çalışıyor muyuz?"""
    return MOBILE


def get_platform_name() -> str:
    """Platform adını döndürür."""
    if ANDROID:
        return "android"
    if IOS:
        return "ios"
    if WINDOWS:
        return "windows"
    if LINUX:
        return "linux"
    if MACOS:
        return "macos"
    return "unknown"


def get_data_dir() -> str:
    """Platforma uygun veri dizinini döndürür."""
    if MOBILE:
        try:
            from plyer import storagepath
            return storagepath.get_app_dir()
        except Exception:
            pass
    # Desktop fallback
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base, "data")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir
