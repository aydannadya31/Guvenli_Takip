/* ============================================
   SecurityMonitor — Frontend Uygulama Mantığı
   ============================================ */

const IS_CLOUD = !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
const API_BASE = '';

// ============ AUTH ============

function getAuth() {
    try {
        const raw = localStorage.getItem('secmon_auth');
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function requireAuth() {
    const auth = getAuth();
    if (!auth) {
        window.location.href = '/login';
        return null;
    }
    renderUserInfo();
    return auth;
}

function logout() {
    localStorage.removeItem('secmon_auth');
    window.location.href = '/login';
}

function renderUserInfo() {
    const auth = getAuth();
    if (!auth) return;
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    if (avatarEl) {
        if (auth.photoURL) {
            avatarEl.innerHTML = `<img src="${auth.photoURL}" alt="avatar" style="width:28px;height:28px;border-radius:50%;">`;
        } else {
            avatarEl.textContent = auth.name ? auth.name.charAt(0).toUpperCase() : '?';
        }
    }
    if (nameEl) {
        nameEl.textContent = auth.name || auth.email || 'Kullanıcı';
    }
}

// ============ PERMISSION GATE ============

const PERMISSION_LIST = [
    { id: 'camera', icon: '📷', label: 'Kamera', desc: 'Canlı görüntü aktarımı' },
    { id: 'microphone', icon: '🎤', label: 'Mikrofon', desc: 'Ses kaydı ve dinleme' },
    { id: 'speaker', icon: '🔊', label: 'Hoparlör', desc: 'Sesli anons ve bildirim' },
    { id: 'location', icon: '📍', label: 'Konum (GPS)', desc: 'Gerçek zamanlı konum takibi' },
    { id: 'storage', icon: '💾', label: 'Depolama', desc: 'Dosya erişimi ve yönetimi' },
];

function checkPermissions() {
    try {
        const saved = localStorage.getItem('secmon_permissions');
        if (saved) return JSON.parse(saved);
    } catch {}
    return null;
}

function showPermissionGate() {
    const gate = document.getElementById('permissionGate');
    if (gate) gate.classList.remove('hidden');
}

function hidePermissionGate() {
    const gate = document.getElementById('permissionGate');
    if (gate) gate.classList.add('hidden');
}

function renderPermissionGate() {
    const container = document.getElementById('gatePermissions');
    if (!container) return;
    container.innerHTML = PERMISSION_LIST.map(p => `
        <div class="gate-permission-item" data-perm="${p.id}">
            <span class="p-icon">${p.icon}</span>
            <div class="p-info">
                <div class="p-label">${p.label}</div>
                <div class="p-desc">${p.desc}</div>
            </div>
            <div class="p-checkbox">&#10003;</div>
        </div>
    `).join('');
}

function updatePermStatus(id, granted) {
    const item = document.querySelector(`.gate-permission-item[data-perm="${id}"]`);
    if (!item) return;
    item.classList.toggle('granted', granted);
}

async function requestAllPermissions() {
    const btn = document.getElementById('grantBtn');
    btn.disabled = true;
    btn.textContent = 'İzinler isteniyor...';

    const results = {};

    // 1. Kamera + Mikrofon (tek getUserMedia ile)
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        results.camera = true;
        results.microphone = true;
        updatePermStatus('camera', true);
        updatePermStatus('microphone', true);
        stream.getTracks().forEach(t => t.stop());
    } catch {
        // Bireysel dene
        try {
            const vs = await navigator.mediaDevices.getUserMedia({ video: true });
            results.camera = true;
            updatePermStatus('camera', true);
            vs.getTracks().forEach(t => t.stop());
        } catch { results.camera = false; updatePermStatus('camera', false); }
        try {
            const as_ = await navigator.mediaDevices.getUserMedia({ audio: true });
            results.microphone = true;
            updatePermStatus('microphone', true);
            as_.getTracks().forEach(t => t.stop());
        } catch { results.microphone = false; updatePermStatus('microphone', false); }
    }

    // 2. Hoparlör — izin gerekmez, her zaman açık
    results.speaker = true;
    updatePermStatus('speaker', true);

    // 3. GPS Konum
    try {
        await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                () => resolve(),
                (err) => reject(err),
                { timeout: 10000, enableHighAccuracy: true }
            );
        });
        results.location = true;
        updatePermStatus('location', true);
    } catch {
        results.location = false;
        updatePermStatus('location', false);
    }

    // 4. Depolama (kalıcı depolama)
    try {
        if (navigator.storage && navigator.storage.persist) {
            await navigator.storage.persist();
        }
        results.storage = true;
        updatePermStatus('storage', true);
    } catch {
        results.storage = true;
        updatePermStatus('storage', true);
    }

    results.granted_at = Date.now();
    localStorage.setItem('secmon_permissions', JSON.stringify(results));

    btn.textContent = 'Tamamlandı';
    setTimeout(hidePermissionGate, 1500);

    return results;
}

// ============ API ============

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    renderPermissionGate();
    if (!checkPermissions()) {
        showPermissionGate();
    }
});
