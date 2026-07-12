/* ============================================
   SecurityMonitor — Admin Panel Logic
   ============================================ */

const API_BASE = '';
let selectedUid = null;
let userListInterval = null;

// ==================== AUTH ====================

function getAdminToken() {
    return localStorage.getItem('secmon_admin_token') || '';
}

function getAuth() {
    try {
        return JSON.parse(localStorage.getItem('secmon_auth') || '{}');
    } catch { return {}; }
}

function requireAdmin() {
    const auth = getAuth();
    const token = getAdminToken();
    if (!token || auth.method !== 'admin') {
        window.location.href = '/login';
    }
    document.getElementById('topbarUser').textContent = auth.name || 'Admin';
}

function logout() {
    localStorage.removeItem('secmon_auth');
    localStorage.removeItem('secmon_admin_token');
    window.location.href = '/login';
}

// ==================== VIEW SWITCHING ====================

function switchView(view) {
    document.querySelectorAll('.topbar-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.topbar-tab[data-view="${view}"]`).classList.add('active');
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');

    if (view === 'admin') {
        refreshUsers();
        startUserPolling();
    } else {
        stopUserPolling();
        const iframe = document.getElementById('userFrame');
        iframe.src = iframe.src;
    }
}

// ==================== USER LIST ====================

async function fetchUsers() {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/users`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return []; }
        const data = await resp.json();
        return data.users || [];
    } catch { return []; }
}

async function refreshUsers() {
    const users = await fetchUsers();
    const list = document.getElementById('userList');
    if (users.length === 0) {
        list.innerHTML = '<p class="placeholder" style="padding:20px;">Bağlı kullanıcı yok</p>';
        return;
    }

    list.innerHTML = users.map(u => `
        <div class="user-list-item ${selectedUid === u.uid ? 'selected' : ''}"
             onclick="selectUser('${u.uid}')">
            <div class="user-avatar">
                ${u.photo_url ? `<img src="${u.photo_url}" alt="">` : (u.name ? u.name.charAt(0).toUpperCase() : '?')}
            </div>
            <div class="user-info">
                <div class="user-name">${u.name || 'İsimsiz'}</div>
                <div class="user-email">${u.email || ''}</div>
            </div>
            <div class="user-status ${u.is_active ? 'online' : 'offline'}"></div>
        </div>
    `).join('');
}

function startUserPolling() {
    stopUserPolling();
    refreshUsers();
    userListInterval = setInterval(refreshUsers, 5000);
}

function stopUserPolling() {
    if (userListInterval) {
        clearInterval(userListInterval);
        userListInterval = null;
    }
}

// ==================== USER SELECTION ====================

async function selectUser(uid) {
    selectedUid = uid;
    refreshUsers();

    const detail = document.getElementById('userDetail');
    detail.innerHTML = '<div class="loading-spinner" style="margin:40px auto;display:block;"></div>';

    try {
        const resp = await fetch(`${API_BASE}/api/admin/user/${uid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();

        renderUserDetail(detail, data);
    } catch (e) {
        detail.innerHTML = '<p class="placeholder">Kullanıcı bilgisi alınamadı</p>';
    }
}

// ==================== DETAIL RENDER ====================

function renderUserDetail(container, data) {
    const user = data.user || {};
    const relay = data.relay || {};
    const isActive = data.is_active;

    container.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar">
                ${user.photo_url ? `<img src="${user.photo_url}" alt="">` : (user.name ? user.name.charAt(0).toUpperCase() : '?')}
            </div>
            <div class="detail-info">
                <h2>${user.name || 'İsimsiz Kullanıcı'}</h2>
                <p>${user.email || ''}</p>
                <span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı'}</span>
            </div>
        </div>

        <div class="info-panel">
            <h3>ℹ️ Kullanıcı Bilgisi</h3>
            <p style="color:var(--text-muted);font-size:13px;">Kullanıcı seçildi. Detaylı bilgiler hazırlanıyor...</p>
        </div>
    `;
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    requireAdmin();
    refreshUsers();
    startUserPolling();
});
