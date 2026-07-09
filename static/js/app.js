/* ============================================
   SecurityMonitor — Frontend Uygulama Mantığı
   Cloud (tarayıcı API) + Lokal (Flask backend)
   ============================================ */

const IS_CLOUD = !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
const API_BASE = '';

// ============ İZİN YÖNETİMİ (Cloud → localStorage, Lokal → Backend) ============

function cloudGetPermissions() {
    const raw = localStorage.getItem('secmon_permissions');
    const perms = raw ? JSON.parse(raw) : {};
    return PERMISSION_DEFS.map(p => ({ ...p, granted: !!perms[p.key] }));
}

function cloudSetPermission(key, granted) {
    const raw = localStorage.getItem('secmon_permissions');
    const perms = raw ? JSON.parse(raw) : {};
    perms[key] = granted;
    localStorage.setItem('secmon_permissions', JSON.stringify(perms));
}

function cloudSetAllPermissions(keys) {
    const perms = {};
    PERMISSION_DEFS.forEach(p => { perms[p.key] = keys.includes(p.key); });
    localStorage.setItem('secmon_permissions', JSON.stringify(perms));
}

function cloudRevokeAll() {
    localStorage.removeItem('secmon_permissions');
}

const PERMISSION_DEFS = [
    { key: 'camera', label: 'Kamera Erişimi', description: 'Kameraya erişerek görüntü alınmasına izin verir.', icon: '📷' },
    { key: 'microphone', label: 'Mikrofon Erişimi', description: 'Ortam seslerini dinlemek için mikrofon kullanımına izin verir.', icon: '🎙️' },
    { key: 'speaker', label: 'Hoparlör Erişimi', description: 'Ses çıkışını test etmek için izin verir.', icon: '🔊' },
    { key: 'location', label: 'Konum Erişimi', description: 'Cihazın GPS konumunu tespit etmeye izin verir.', icon: '📍' },
    { key: 'storage', label: 'Depolama Erişimi', description: 'Tarayıcı depolama alanını analiz etmeye izin verir.', icon: '💾' },
];

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

async function loadPermissions() {
    if (IS_CLOUD) return cloudGetPermissions();
    const data = await fetchJSON(`${API_BASE}/api/permissions`);
    return data.permissions;
}

async function grantPermission(key) {
    if (IS_CLOUD) { cloudSetPermission(key, true); return { status: 'ok' }; }
    return fetchJSON(`${API_BASE}/api/permissions/grant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    });
}

async function revokePermission(key) {
    if (IS_CLOUD) { cloudSetPermission(key, false); return { status: 'ok' }; }
    return fetchJSON(`${API_BASE}/api/permissions/revoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    });
}

async function revokeAllPermissions() {
    if (IS_CLOUD) { cloudRevokeAll(); return; }
    return fetchJSON(`${API_BASE}/api/permissions/revoke-all`, { method: 'POST' });
}

// ============ PERMISSION GATE ============

async function initPermissionGate() {
    const gate = document.getElementById('permissionGate');
    const container = document.getElementById('gatePermissions');
    const acceptBtn = document.getElementById('gateAcceptBtn');

    const perms = await loadPermissions();
    const allGranted = perms.every(p => p.granted);

    if (allGranted) {
        gate.classList.add('hidden');
        return;
    }

    container.innerHTML = '';
    const selected = {};

    perms.forEach(p => {
        const item = document.createElement('div');
        item.className = 'gate-permission-item';
        if (p.granted) item.classList.add('granted');
        item.innerHTML = `
            <span class="p-icon">${p.icon}</span>
            <div class="p-info">
                <div class="p-label">${p.label}</div>
                <div class="p-desc">${p.description}</div>
            </div>
            <div class="p-checkbox">${p.granted ? '✓' : ''}</div>
        `;
        item.dataset.key = p.key;
        selected[p.key] = p.granted;

        item.addEventListener('click', () => {
            const isGranted = !item.classList.contains('granted');
            item.classList.toggle('granted');
            item.querySelector('.p-checkbox').textContent = isGranted ? '✓' : '';
            selected[p.key] = isGranted;
            updateAcceptBtn();
        });

        container.appendChild(item);
    });

    function updateAcceptBtn() {
        const anySelected = Object.values(selected).some(v => v);
        acceptBtn.disabled = !anySelected;
    }

    acceptBtn.addEventListener('click', async () => {
        const grantedKeys = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
        if (IS_CLOUD) {
            cloudSetAllPermissions(grantedKeys);
        } else {
            for (const [key, val] of Object.entries(selected)) {
                if (val) await grantPermission(key);
            }
        }
        gate.classList.add('hidden');
        await refreshDashboard();
    });

    document.getElementById('gateRevokeAll').addEventListener('click', async () => {
        await revokeAllPermissions();
        gate.classList.add('hidden');
        await refreshDashboard();
    });

    updateAcceptBtn();
}

// ============ NAVİGASYON ============

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`page-${page}`).classList.add('active');

            if (page === 'permissions') renderPermissionsPage();
            if (page === 'camera') scanCamera();
            if (page === 'audio') scanAudio();
            if (page === 'location') scanLocation();
            if (page === 'storage') scanStorage();
        });
    });
}

// ============ DASHBOARD ============

async function refreshDashboard() {
    const perms = await loadPermissions();
    const statusGrid = document.getElementById('statusGrid');
    const detailDiv = document.getElementById('dashboardDetail');

    const cards = statusGrid.querySelectorAll('.status-card');
    cards.forEach(card => {
        const module = card.dataset.module;
        const statusEl = card.querySelector('.card-status');
        const indicator = card.querySelector('.card-indicator');
        if (module === 'system') {
            statusEl.textContent = IS_CLOUD ? 'Bulut modu' : 'Sistem bilgisi alınıyor...';
            indicator.className = 'card-indicator pending';
            return;
        }
        const perm = perms.find(p => p.key === module);
        if (perm && !perm.granted) {
            statusEl.textContent = 'İzin verilmedi';
            indicator.className = 'card-indicator blocked';
        } else {
            statusEl.textContent = IS_CLOUD ? 'Tarayıcı hazır' : 'Taranıyor...';
            indicator.className = 'card-indicator pending';
        }
    });

    let data;
    if (IS_CLOUD) {
        data = await cloudScanAll();
    } else {
        data = await fetchJSON(`${API_BASE}/api/scan/all`);
    }

    detailDiv.innerHTML = '<h3 style="margin-bottom:16px;">📋 Tarama Özeti</h3>';

    for (const [module, result] of Object.entries(data)) {
        if (module === 'permissions') continue;
        const card = statusGrid.querySelector(`[data-module="${module}"]`);
        if (!card) continue;
        const statusEl = card.querySelector('.card-status');
        const indicator = card.querySelector('.card-indicator');

        if (result.status === 'blocked') {
            statusEl.textContent = '🔒 İzin verilmedi';
            indicator.className = 'card-indicator blocked';
        } else if (result.status === 'ok') {
            statusEl.textContent = '✅ Çalışıyor';
            indicator.className = 'card-indicator ok';
        } else if (result.status === 'cloud') {
            statusEl.textContent = '🌐 Tarayıcı API';
            indicator.className = 'card-indicator warning';
        } else if (result.error) {
            statusEl.textContent = '❌ Hata';
            indicator.className = 'card-indicator error';
        } else {
            statusEl.textContent = 'ℹ️ Veri mevcut';
            indicator.className = 'card-indicator warning';
        }
    }

    const permList = data.permissions || [];
    let detailHTML = '<div class="info-panel"><h3>🔐 İzin Durumu</h3>';
    permList.forEach(p => {
        detailHTML += `<div class="info-row">
            <span class="label">${p.icon} ${p.label}</span>
            <span class="value" style="color:${p.granted ? 'var(--accent-green)' : 'var(--accent-red)'}">
                ${p.granted ? '✅ İzin Verildi' : '⛔ İzin Yok'}
            </span>
        </div>`;
    });
    detailHTML += '</div>';
    detailDiv.innerHTML += detailHTML;
}

async function cloudScanAll() {
    const perms = cloudGetPermissions();
    const result = { permissions: perms };

    const pMap = {};
    perms.forEach(p => { pMap[p.key] = p.granted; });

    result.camera = pMap.camera ? await cloudScanCameraRaw() : { status: 'blocked' };
    result.audio = (pMap.microphone || pMap.speaker) ? await cloudScanAudioRaw() : { status: 'blocked' };
    result.location = pMap.location ? await cloudScanLocationRaw() : { status: 'blocked' };
    result.storage = pMap.storage ? await cloudScanStorageRaw() : { status: 'blocked' };
    result.system = { status: 'ok', mode: 'cloud', browser: navigator.userAgent };

    return result;
}

// ===================== KAMERA (Cloud - Browser API) =====================

let _cameraStream = null;

function stopCameraStream() {
    if (_cameraStream) {
        _cameraStream.getTracks().forEach(t => t.stop());
        _cameraStream = null;
    }
}

async function cloudScanCameraRaw() {
    try {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return { status: 'error', error: 'Tarayıcı desteklemiyor' };
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        return {
            status: 'ok',
            camera_count: cams.length,
            cameras: cams.map((d, i) => ({ label: d.label || `Kamera #${i + 1}`, deviceId: d.deviceId })),
        };
    } catch (e) {
        return { status: 'error', error: e.message };
    }
}

async function cloudCaptureCamera(deviceId) {
    const preview = document.getElementById('cameraPreview');
    try {
        stopCameraStream();
        const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true };
        _cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

        const video = document.createElement('video');
        video.srcObject = _cameraStream;
        video.playsInline = true;
        video.autoplay = true;
        video.className = 'camera-preview';
        video.style.maxWidth = '100%';

        preview.innerHTML = '';
        preview.appendChild(video);

        // Capture button
        const captureBtn = document.createElement('button');
        captureBtn.className = 'btn btn-secondary';
        captureBtn.textContent = '📸 Fotoğraf Çek';
        captureBtn.style.marginTop = '10px';
        preview.appendChild(captureBtn);

        const img = document.createElement('img');
        img.className = 'camera-preview';
        img.style.display = 'none';
        preview.appendChild(img);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'btn btn-ghost';
        stopBtn.textContent = '⏹ Kamera Kapat';
        stopBtn.style.marginTop = '6px';
        preview.appendChild(stopBtn);

        captureBtn.addEventListener('click', () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            img.src = canvas.toDataURL('image/jpeg');
            img.style.display = 'block';
            video.style.display = 'none';
            stopCameraStream();
        });

        stopBtn.addEventListener('click', () => {
            stopCameraStream();
            video.style.display = 'none';
            preview.innerHTML = '<p class="placeholder" style="padding:20px;">Kamera kapatıldı</p>';
        });

        return { status: 'ok' };
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            preview.innerHTML = '<p class="placeholder">🔒 Kamera izni reddedildi. Tarayıcı ayarlarından izin verin.</p>';
        } else {
            preview.innerHTML = `<p class="placeholder">❌ Kamera hatası: ${e.message}</p>`;
        }
        return { status: 'error', error: e.message };
    }
}

async function scanCamera() {
    const container = document.getElementById('cameraContent');
    const perms = await loadPermissions();
    const camPerm = perms.find(p => p.key === 'camera');

    if (!camPerm?.granted) {
        container.innerHTML = `<p class="placeholder">🔒 Kamera izni verilmedi. İzinler sayfasından aktifleştirin.</p>`;
        return;
    }

    if (IS_CLOUD) {
        const data = await cloudScanCameraRaw();
        if (data.status === 'error') {
            container.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
            return;
        }
        let html = '<div class="module-grid">';
        html += `<div class="info-panel">
            <h3>📷 Kamera Durumu</h3>
            <div class="info-row"><span class="label">Bulunan Kamera</span><span class="value">${data.camera_count || 0}</span></div>
            ${(data.cameras || []).map((c, i) => `
                <div class="info-row">
                    <span class="label">Kamera #${i + 1}</span>
                    <span class="value">${c.label}</span>
                </div>
            `).join('')}
            <p style="margin-top:12px;font-size:12px;color:var(--text-muted);">🌐 Tarayıcı API kullanılıyor</p>
        </div>`;
        html += `<div class="info-panel">
            <h3>📸 Canlı Görüntü</h3>
            <button class="btn btn-secondary" onclick="cloudCaptureCamera()">📷 Kamerayı Aç</button>
            <div id="cameraPreview"></div>
        </div>`;
        html += '</div>';
        container.innerHTML = html;
    } else {
        // Lokal mod — Flask backend
        const data = await fetchJSON(`${API_BASE}/api/scan/camera`);
        if (data.status === 'error') {
            container.innerHTML = `<p class="placeholder">❌ Kamera taraması başarısız: ${data.error}</p>`;
            return;
        }
        let html = '<div class="module-grid">';
        html += `<div class="info-panel">
            <h3>📷 Kamera Durumu</h3>
            <div class="info-row"><span class="label">Bulunan Kamera</span><span class="value">${data.camera_count || 0}</span></div>
            ${(data.cameras || []).map((c, i) => `
                <div class="info-row"><span class="label">Kamera #${i + 1}</span><span class="value">${c.label}</span></div>
            `).join('')}
        </div>`;
        html += `<div class="info-panel">
            <h3>📸 Görüntü</h3>
            <button class="btn btn-secondary" onclick="captureCamera(0)">Görüntü Yakala</button>
            <div id="cameraPreview"></div>
        </div>`;
        html += '</div>';
        container.innerHTML = html;
    }
}

async function captureCamera(id) {
    const div = document.getElementById('cameraPreview');
    div.innerHTML = '<div class="loading-spinner"></div>';
    const data = await fetchJSON(`${API_BASE}/api/scan/camera/capture?id=${id}`);
    if (data.image) {
        div.innerHTML = `<img class="camera-preview" src="data:image/jpeg;base64,${data.image}" alt="Kamera görüntüsü">`;
    } else {
        div.innerHTML = `<p class="placeholder">❌ ${data.error || 'Görüntü alınamadı'}</p>`;
    }
}

// ===================== SES (Cloud - Browser API) =====================

let _audioStream = null;
let _audioContext = null;

function stopAudioStream() {
    if (_audioStream) {
        _audioStream.getTracks().forEach(t => t.stop());
        _audioStream = null;
    }
    if (_audioContext) {
        _audioContext.close();
        _audioContext = null;
    }
}

async function cloudScanAudioRaw() {
    try {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return { status: 'error', error: 'Tarayıcı desteklemiyor' };
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(d => d.kind === 'audioinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');
        return {
            status: 'ok',
            microphone_count: mics.length,
            speaker_count: speakers.length,
            devices: {
                microphones: mics.map((d, i) => ({ name: d.label || `Mikrofon #${i + 1}`, deviceId: d.deviceId })),
                speakers: speakers.map((d, i) => ({ name: d.label || `Hoparlör #${i + 1}`, deviceId: d.deviceId })),
            },
        };
    } catch (e) {
        return { status: 'error', error: e.message };
    }
}

async function cloudRecordAudio() {
    const div = document.getElementById('audioResult');
    try {
        stopAudioStream();
        _audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = _audioContext.createMediaStreamSource(_audioStream);
        const analyser = _audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let peak = 0;
        let sampleCount = 0;

        div.innerHTML = '<div class="loading-spinner"></div> Dinleniyor...';

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                peak = Math.max(peak, avg);
                sampleCount++;

                // Ses dalgası görseli
                const barCount = 40;
                const bars = Array.from({ length: barCount }, (_, i) => {
                    const idx = Math.floor(i / barCount * dataArray.length);
                    return `<div class="bar" style="height:${(dataArray[idx] / 255) * 50 + 2}px;background:${dataArray[idx] > 100 ? 'var(--accent-green)' : 'var(--accent-cyan)'};"></div>`;
                }).join('');
                div.innerHTML = `<div class="audio-wave">${bars}</div>
                    <div class="info-row"><span class="label">Ses Seviyesi</span><span class="value">${Math.round(avg / 2.55)}%</span></div>`;

                if (sampleCount >= 30) { // ~3sn
                    clearInterval(interval);
                    stopAudioStream();
                    const level = Math.round(peak / 2.55);
                    resolve({ status: 'ok', level: level, has_signal: level > 15 });
                }
            }, 100);
        });
    } catch (e) {
        if (e.name === 'NotAllowedError') {
            div.innerHTML = '<p class="placeholder">🔒 Mikrofon izni reddedildi.</p>';
        } else {
            div.innerHTML = `<p class="placeholder">❌ ${e.message}</p>`;
        }
        return { status: 'error', error: e.message };
    }
}

async function cloudTestSpeaker() {
    const div = document.getElementById('speakerResult');
    try {
        _audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = _audioContext.createOscillator();
        const gain = _audioContext.createGain();
        gain.gain.value = 0.3;
        oscillator.type = 'sine';
        oscillator.frequency.value = 440;
        oscillator.connect(gain);
        gain.connect(_audioContext.destination);
        oscillator.start();
        div.innerHTML = `<div class="info-row">
            <span class="label">🔊 Hoparlör Testi</span>
            <span class="value" style="color:var(--accent-green)">✅ Ses çalınıyor (440Hz)</span>
        </div>`;
        setTimeout(() => {
            oscillator.stop();
            _audioContext.close();
            _audioContext = null;
            div.innerHTML += '<p style="font-size:12px;color:var(--text-muted);margin-top:8px;">Test tonu tamamlandı</p>';
        }, 2000);
        return { status: 'ok', message: 'Test sesi çalınıyor (440Hz)' };
    } catch (e) {
        div.innerHTML = `<p class="placeholder">❌ ${e.message}</p>`;
        return { status: 'error', error: e.message };
    }
}

async function scanAudio() {
    const container = document.getElementById('audioContent');
    const perms = await loadPermissions();
    const micPerm = perms.find(p => p.key === 'microphone');
    const spkPerm = perms.find(p => p.key === 'speaker');
    const hasPerm = micPerm?.granted || spkPerm?.granted;

    if (!hasPerm) {
        container.innerHTML = `<p class="placeholder">🔒 Ses izni verilmedi.</p>`;
        return;
    }

    if (IS_CLOUD) {
        const data = await cloudScanAudioRaw();
        if (data.status === 'error') {
            container.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
            return;
        }
        let html = '<div class="module-grid">';
        html += `<div class="info-panel">
            <h3>🎙️ Mikrofonlar (${data.microphone_count || 0})</h3>`;
        if (data.devices?.microphones) {
            (data.devices.microphones || []).forEach(m => {
                html += `<div class="info-row"><span class="label">${m.name}</span><span class="value">✅</span></div>`;
            });
        }
        html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="doRecordAudio()">🔴 Dinle (3sn)</button>
            <div id="audioResult" style="margin-top:10px;"></div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">🌐 Tarayıcı API</p>
        </div>`;
        html += `<div class="info-panel">
            <h3>🔊 Hoparlörler (${data.speaker_count || 0})</h3>`;
        if (data.devices?.speakers) {
            (data.devices.speakers || []).forEach(s => {
                html += `<div class="info-row"><span class="label">${s.name}</span><span class="value">✅</span></div>`;
            });
        }
        html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="doTestSpeaker()">🔊 Hoparlör Testi</button>
            <div id="speakerResult" style="margin-top:10px;"></div>
        </div>`;
        html += '</div>';
        container.innerHTML = html;
    } else {
        // Lokal mod — Flask backend
        const data = await fetchJSON(`${API_BASE}/api/scan/audio`);
        if (data.status === 'error') {
            container.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
            return;
        }
        let html = '<div class="module-grid">';
        html += `<div class="info-panel">
            <h3>🎙️ Mikrofonlar (${data.microphone_count || 0})</h3>`;
        if (data.devices?.microphones) {
            data.devices.microphones.forEach(m => {
                html += `<div class="info-row"><span class="label">${m.name}</span><span class="value">${m.channels} kanal, ${m.default_samplerate}Hz</span></div>`;
            });
        }
        html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="recordAudio()">🔴 Kayıt Al (2sn)</button>
            <div id="audioResult" style="margin-top:10px;"></div>
        </div>`;
        html += `<div class="info-panel">
            <h3>🔊 Hoparlörler (${data.speaker_count || 0})</h3>`;
        if (data.devices?.speakers) {
            data.devices.speakers.forEach(s => {
                html += `<div class="info-row"><span class="label">${s.name}</span><span class="value">${s.channels} kanal</span></div>`;
            });
        }
        html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="testSpeaker()">🔊 Hoparlör Testi</button>
            <div id="speakerResult" style="margin-top:10px;"></div>
        </div>`;
        html += '</div>';
        container.innerHTML = html;
    }
}

// Cloud audio wrappers
async function doRecordAudio() {
    const result = await cloudRecordAudio();
    if (result.status === 'ok') {
        const div = document.getElementById('audioResult');
        div.innerHTML += `<div class="info-row"><span class="label">Sinyal Tespiti</span>
            <span class="value" style="color:${result.has_signal ? 'var(--accent-green)' : 'var(--accent-yellow)'}">${result.has_signal ? '✅ Var' : '⚠️ Zayıf'}</span></div>`;
    }
}

async function doTestSpeaker() {
    await cloudTestSpeaker();
}

// Lokal audio wrappers
async function recordAudio() {
    const div = document.getElementById('audioResult');
    div.innerHTML = '<div class="loading-spinner"></div> Kayıt alınıyor...';
    const data = await fetchJSON(`${API_BASE}/api/scan/audio/record?duration=2`);
    if (data.status === 'ok') {
        div.innerHTML = `
            <div class="audio-wave">${Array(40).fill(0).map(() => `<div class="bar" style="height:${Math.random() * data.level + 5}px;"></div>`).join('')}</div>
            <div class="info-row"><span class="label">Ses Seviyesi</span><span class="value">${data.level}%</span></div>
            <div class="info-row"><span class="label">Sinyal Tespiti</span><span class="value" style="color:${data.has_signal ? 'var(--accent-green)' : 'var(--accent-yellow)'}">${data.has_signal ? '✅ Var' : '⚠️ Zayıf'}</span></div>
        `;
    } else {
        div.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
    }
}

async function testSpeaker() {
    const div = document.getElementById('speakerResult');
    div.innerHTML = '<div class="loading-spinner"></div> Hoparlör test ediliyor...';
    const data = await fetchJSON(`${API_BASE}/api/scan/audio/test-speaker`);
    if (data.status === 'ok') {
        div.innerHTML = `<div class="info-row"><span class="label">Sonuç</span><span class="value" style="color:var(--accent-green)">✅ ${data.message}</span></div>`;
    } else {
        div.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
    }
}

// ===================== KONUM (Cloud - Browser Geolocation API) =====================

async function cloudScanLocationRaw() {
    try {
        if (!navigator.geolocation) {
            return { status: 'error', error: 'Tarayıcı GPS desteklemiyor' };
        }
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000,
            });
        });

        const result = {
            status: 'ok',
            source: 'gps',
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude || 0,
            accuracy: Math.round(pos.coords.accuracy),
            altitudeAccuracy: pos.coords.altitudeAccuracy ? Math.round(pos.coords.altitudeAccuracy) : null,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
        };

        // IP destek bilgisi ekle
        try {
            const ipResp = await fetchJSON(`${API_BASE}/api/ip-location`);
            if (ipResp.status === 'ok') {
                result.ip_support = {
                    ip: ipResp.ip,
                    country: ipResp.country,
                    country_code: ipResp.country_code,
                    city: ipResp.city,
                    isp: ipResp.isp,
                };
            }
        } catch (_) { /* IP bilgisi opsiyonel */ }

        return result;
    } catch (e) {
        if (e.code === 1) { // PERMISSION_DENIED
            return { status: 'blocked', error: 'Konum izni reddedildi' };
        }
        // Geolocation başarısız olursa IP'e düş
        try {
            const ipResp = await fetchJSON(`${API_BASE}/api/ip-location`);
            if (ipResp.status === 'ok') return ipResp;
        } catch (_) {}
        return { status: 'error', error: e.message };
    }
}

async function scanLocation() {
    const container = document.getElementById('locationContent');
    const perms = await loadPermissions();
    const locPerm = perms.find(p => p.key === 'location');

    if (!locPerm?.granted) {
        container.innerHTML = `<p class="placeholder">🔒 Konum izni verilmedi.</p>`;
        return;
    }

    let data;
    if (IS_CLOUD) {
        container.innerHTML = '<p class="placeholder"><div class="loading-spinner"></div> GPS konumu alınıyor...</p>';
        data = await cloudScanLocationRaw();
    } else {
        data = await fetchJSON(`${API_BASE}/api/scan/location`);
    }

    if (data.status === 'blocked') {
        container.innerHTML = `<p class="placeholder">🔒 Konum izni verilmedi.</p>`;
        return;
    }
    if (data.status === 'error') {
        container.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
        return;
    }

    let html = '<div class="module-grid">';
    if (data.source === 'gps') {
        html += `<div class="info-panel">
            <h3>📍 GPS Konumu <span style="font-size:11px;color:var(--accent-green);font-weight:normal;">(Ana)</span></h3>
            <div class="info-row"><span class="label">Enlem</span><span class="value">${data.latitude || '-'}</span></div>
            <div class="info-row"><span class="label">Boylam</span><span class="value">${data.longitude || '-'}</span></div>
            <div class="info-row"><span class="label">İrtifa</span><span class="value">${data.altitude || '0'} m</span></div>
            <div class="info-row"><span class="label">Doğruluk</span><span class="value">${data.accuracy || '-'} m</span></div>
            ${data.heading ? `<div class="info-row"><span class="label">Yön</span><span class="value">${data.heading}°</span></div>` : ''}
            ${data.speed ? `<div class="info-row"><span class="label">Hız</span><span class="value">${data.speed} m/s</span></div>` : ''}
            ${IS_CLOUD ? '<p style="font-size:11px;color:var(--text-muted);margin-top:8px;">🌐 Tarayıcı Geolocation API</p>' : ''}
        </div>`;
        if (data.ip_support) {
            html += `<div class="info-panel">
                <h3>🌐 IP Destek <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(Yardımcı)</span></h3>
                <div class="info-row"><span class="label">IP</span><span class="value">${data.ip_support.ip || '-'}</span></div>
                <div class="info-row"><span class="label">Ülke</span><span class="value">${data.ip_support.country || '-'} ${data.ip_support.country_code || ''}</span></div>
                <div class="info-row"><span class="label">Şehir</span><span class="value">${data.ip_support.city || '-'}</span></div>
                <div class="info-row"><span class="label">ISP</span><span class="value">${data.ip_support.isp || '-'}</span></div>
            </div>`;
        }
    } else {
        html += `<div class="info-panel">
            <h3>🌐 IP Tabanlı Konum</h3>
            <div class="info-row"><span class="label">IP Adresi</span><span class="value">${data.ip || '-'}</span></div>
            <div class="info-row"><span class="label">Ülke</span><span class="value">${data.country || '-'} ${data.country_code ? '(' + data.country_code + ')' : ''}</span></div>
            <div class="info-row"><span class="label">Bölge</span><span class="value">${data.region || '-'}</span></div>
            <div class="info-row"><span class="label">Şehir</span><span class="value">${data.city || '-'}</span></div>
            <div class="info-row"><span class="label">ISP</span><span class="value">${data.isp || '-'}</span></div>
        </div>`;
        html += `<div class="info-panel">
            <h3>🗺️ Koordinatlar</h3>
            <div class="map-placeholder">
                ${data.latitude && data.longitude
                    ? `📍 ${data.latitude}, ${data.longitude}<br><small style="color:var(--text-muted)">(IP tabanlı, hassas değil)</small>`
                    : 'Koordinat mevcut değil'}
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ===================== DEPOLAMA (Cloud - Browser Storage API) =====================

async function cloudScanStorageRaw() {
    try {
        const result = { status: 'ok', source: 'browser' };

        if (navigator.storage?.estimate) {
            const est = await navigator.storage.estimate();
            result.quota = est.quota ? (est.quota / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'Bilinmiyor';
            result.usage = est.usage ? (est.usage / 1024 / 1024).toFixed(1) + ' MB' : 'Bilinmiyor';
            result.usage_percent = est.quota && est.usage ? Math.round((est.usage / est.quota) * 100) : 0;
        }

        result.browser_info = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            cookiesEnabled: navigator.cookieEnabled,
            hardwareConcurrency: navigator.hardwareConcurrency || 'Bilinmiyor',
            deviceMemory: navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'Bilinmiyor',
        };

        return result;
    } catch (e) {
        return { status: 'error', error: e.message };
    }
}

async function scanStorage() {
    const container = document.getElementById('storageContent');
    const perms = await loadPermissions();
    const storPerm = perms.find(p => p.key === 'storage');

    let data;
    if (IS_CLOUD) {
        if (!storPerm?.granted) {
            container.innerHTML = `<p class="placeholder">🔒 Depolama izni verilmedi</p>`;
            return;
        }
        data = await cloudScanStorageRaw();
    } else {
        data = await fetchJSON(`${API_BASE}/api/scan/storage`);
    }

    let html = '<div class="module-grid">';

    if (IS_CLOUD) {
        // Cloud: browser storage info
        html += `<div class="info-panel">
            <h3>🌐 Tarayıcı Depolama</h3>`;
        if (data.quota) {
            html += `<div class="info-row"><span class="label">Depolama Kotası</span><span class="value">${data.quota}</span></div>`;
            html += `<div class="info-row"><span class="label">Kullanılan</span><span class="value">${data.usage}</span></div>`;
            if (data.usage_percent !== undefined) {
                const color = data.usage_percent > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
                html += `
                    <div style="margin:12px 0;">
                        <div class="disk-bar"><div class="disk-bar-fill" style="width:${data.usage_percent}%;background:${color};"></div></div>
                        <div style="font-size:11px;color:var(--text-muted);">${data.usage_percent}% dolu</div>
                    </div>`;
            }
        } else {
            html += `<p class="placeholder">Depolama kotası bilgisi alınamadı</p>`;
        }
        html += `</div>`;

        html += `<div class="info-panel">
            <h3>🖥️ Tarayıcı Bilgisi</h3>
            <div class="info-row"><span class="label">Platform</span><span class="value">${data.browser_info?.platform || '-'}</span></div>
            <div class="info-row"><span class="label">Dil</span><span class="value">${data.browser_info?.language || '-'}</span></div>
            <div class="info-row"><span class="label">İşlemci Çekirdeği</span><span class="value">${data.browser_info?.hardwareConcurrency || '-'}</span></div>
            <div class="info-row"><span class="label">RAM</span><span class="value">${data.browser_info?.deviceMemory || '-'}</span></div>
            <div class="info-row"><span class="label">Çerezler</span><span class="value">${data.browser_info?.cookiesEnabled ? '✅ Aktif' : '⛔ Kapalı'}</span></div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">🌐 Tarayıcı API (lokal disk bilgisi mevcut değil)</p>
        </div>`;
    } else {
        // Lokal: Python backend
        if (data.system?.status === 'ok') {
            html += `<div class="info-panel">
                <h3>🖥️ Sistem</h3>
                <div class="info-row"><span class="label">İşletim Sistemi</span><span class="value">${data.system.system || '-'}</span></div>
                <div class="info-row"><span class="label">Cihaz Adı</span><span class="value">${data.system.hostname || '-'}</span></div>
                <div class="info-row"><span class="label">İşlemci</span><span class="value">${data.system.processor || '-'}</span></div>
                <div class="info-row"><span class="label">Mimari</span><span class="value">${data.system.architecture || '-'}</span></div>
                <div class="info-row"><span class="label">Toplam RAM</span><span class="value">${data.system.ram_total_gb || 0} GB</span></div>
                <div class="info-row"><span class="label">Kullanılabilir RAM</span><span class="value">${data.system.ram_available_gb || 0} GB (${data.system.ram_percent_used || 0}% dolu)</span></div>
            </div>`;
        }
        if (data.storage?.status === 'blocked') {
            html += `<div class="info-panel"><p class="placeholder">🔒 Depolama izni verilmedi</p></div>`;
        } else if (data.storage?.status === 'ok') {
            html += `<div class="info-panel"><h3>💾 Diskler (${data.storage.disk_count || 0})</h3>`;
            (data.storage.disks || []).forEach(d => {
                const color = d.percent_used > 90 ? 'var(--accent-red)' : d.percent_used > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
                html += `
                    <div style="margin-bottom:14px;">
                        <div class="info-row"><span class="label">${d.device} — ${d.type}</span><span class="value">${d.used_gb} GB / ${d.total_gb} GB</span></div>
                        <div class="disk-bar"><div class="disk-bar-fill" style="width:${d.percent_used}%;background:${color};"></div></div>
                        <div style="font-size:11px;color:var(--text-muted);">${d.fstype} · ${d.percent_used}% dolu · ${d.free_gb} GB boş</div>
                    </div>`;
            });
            html += '</div>';
        } else {
            html += `<div class="info-panel"><p class="placeholder">❌ Depolama bilgisi alınamadı</p></div>`;
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

// ============ İZİNLER SAYFASI ============

async function renderPermissionsPage() {
    const container = document.getElementById('permissionsList');
    const perms = await loadPermissions();

    let html = '';
    perms.forEach(p => {
        html += `
        <div class="permission-item">
            <span class="p-icon">${p.icon}</span>
            <div class="p-info">
                <div class="p-label">${p.label}</div>
                <div class="p-desc">${p.description}</div>
            </div>
            <div class="toggle-switch ${p.granted ? 'on' : ''}" data-key="${p.key}"></div>
        </div>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('click', async () => {
            const key = toggle.dataset.key;
            const isOn = toggle.classList.contains('on');
            if (isOn) {
                await revokePermission(key);
                toggle.classList.remove('on');
            } else {
                await grantPermission(key);
                toggle.classList.add('on');
            }
        });
    });

    document.getElementById('revokeAllBtn').addEventListener('click', async () => {
        if (confirm('Tüm izinleri iptal etmek istediğinize emin misiniz?')) {
            await revokeAllPermissions();
            await renderPermissionsPage();
            await refreshDashboard();
        }
    });
}

// ============ BAŞLANGIÇ ============

document.addEventListener('DOMContentLoaded', async () => {
    // Cloud modu badge
    if (IS_CLOUD) {
        const badge = document.createElement('div');
        badge.style.cssText = 'position:fixed;top:8px;right:8px;background:var(--accent-blue);color:white;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;z-index:999;';
        badge.textContent = '🌐 Bulut Modu';
        document.body.appendChild(badge);
    }

    initNavigation();

    document.getElementById('refreshAllBtn').addEventListener('click', refreshDashboard);
    document.getElementById('scanCameraBtn').addEventListener('click', scanCamera);
    document.getElementById('scanAudioBtn').addEventListener('click', scanAudio);
    document.getElementById('scanLocationBtn').addEventListener('click', scanLocation);
    document.getElementById('scanStorageBtn').addEventListener('click', scanStorage);

    await initPermissionGate();

    document.querySelectorAll('.status-card').forEach(card => {
        card.addEventListener('click', () => {
            const module = card.dataset.module;
            const navItem = document.querySelector(`.nav-item[data-page="${module}"]`);
            if (navItem) navItem.click();
        });
    });

    await refreshDashboard();
});
