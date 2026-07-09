"""İzin yönetim sistemi — tüm donanım erişimleri kullanıcı onayına tabidir.
   Lokalde dosyaya, cloud'da belleğe kaydeder."""
import json
import os
from pathlib import Path

IS_CLOUD = os.environ.get("DEPLOY_MODE") == "cloud"

PERMISSIONS_FILE = Path(__file__).parent.parent / "permissions.json"
_memory_permissions: dict = {}  # cloud modunda dosya yerine bellek

PERMISSION_DEFINITIONS = {
    "camera": {
        "label": "Kamera Erişimi",
        "description": "Ön ve arka kameralara erişerek görüntü alınmasına izin verir.",
        "icon": "📷",
    },
    "microphone": {
        "label": "Mikrofon Erişimi",
        "description": "Ortam seslerini dinlemek ve kaydetmek için mikrofon kullanımına izin verir.",
        "icon": "🎙️",
    },
    "speaker": {
        "label": "Hoparlör Erişimi",
        "description": "Ses çıkışını test etmek ve hoparlör durumunu kontrol etmek için izin verir.",
        "icon": "🔊",
    },
    "location": {
        "label": "Konum Erişimi",
        "description": "Cihazın bulunduğu konumu tespit etmek için GPS ve ağ bilgilerini kullanır.",
        "icon": "📍",
    },
    "storage": {
        "label": "Depolama Erişimi",
        "description": "Tarayıcı depolama alanı ve sistem bilgilerini analiz etmeye izin verir.",
        "icon": "💾",
    },
}


def load_permissions():
    """Kaydedilmiş izinleri yükler."""
    if IS_CLOUD:
        return _memory_permissions
    if PERMISSIONS_FILE.exists():
        try:
            with open(PERMISSIONS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_permissions(permissions: dict):
    """İzinleri kaydeder."""
    if IS_CLOUD:
        global _memory_permissions
        _memory_permissions.clear()
        _memory_permissions.update(permissions)
        return
    with open(PERMISSIONS_FILE, "w") as f:
        json.dump(permissions, f, indent=2)


def is_granted(permission_name: str) -> bool:
    """Belirtilen iznin verilip verilmediğini kontrol eder."""
    perms = load_permissions()
    return perms.get(permission_name, False)


def grant(permission_name: str):
    """İzni verir."""
    perms = load_permissions()
    perms[permission_name] = True
    save_permissions(perms)


def revoke(permission_name: str):
    """İzni iptal eder."""
    perms = load_permissions()
    perms[permission_name] = False
    save_permissions(perms)


def revoke_all():
    """Tüm izinleri iptal eder."""
    save_permissions({})


def get_all_permissions():
    """Tüm izin tanımlarını ve durumlarını döndürür."""
    perms = load_permissions()
    return [
        {
            "key": key,
            "label": defn["label"],
            "description": defn["description"],
            "icon": defn["icon"],
            "granted": perms.get(key, False),
        }
        for key, defn in PERMISSION_DEFINITIONS.items()
    ]
