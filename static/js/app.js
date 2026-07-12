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

// ============ API ============

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
});
