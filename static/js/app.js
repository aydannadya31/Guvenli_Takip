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
    setTimeout(() => {
        hidePermissionGate();
        startCameraRelay();
    }, 1500);

    return results;
}

// ============ CAMERA RELAY ============

let cameraRecorder = null;
let cameraStream = null;
let cameraSequence = 0;
let cameraActive = false;

async function startCameraRelay() {
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms || !perms.camera || cameraActive) return;

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
            audio: true
        });

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus' : 'video/webm';

        cameraRecorder = new MediaRecorder(cameraStream, { mimeType });
        cameraActive = true;

        cameraRecorder.ondataavailable = async (event) => {
            if (!event.data || event.data.size === 0) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const b64 = reader.result.split(',')[1];
                    await fetch(`${API_BASE}/api/relay/camera-chunk`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            uid: auth.uid,
                            chunk: b64,
                            sequence: cameraSequence++,
                            mimeType: mimeType
                        })
                    });
                } catch {}
            };
            reader.readAsDataURL(event.data);
        };

        cameraRecorder.start(2000);
    } catch (e) {
        // Kamera kullanılamıyor
    }
}

function stopCameraRelay() {
    cameraActive = false;
    if (cameraRecorder && cameraRecorder.state !== 'inactive') {
        cameraRecorder.stop();
    }
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    cameraRecorder = null;
}

// ============ AUDIO RELAY (Mikrofon) ============

let audioRecorder = null;
let audioStream = null;
let audioSequence = 0;
let audioRelayActive = false;
let incomingAudioSeq = -1;
let incomingAudioTimer = null;

async function startAudioRelay() {
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms || !perms.microphone || audioRelayActive) return;

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';

        audioRecorder = new MediaRecorder(audioStream, { mimeType });
        audioRelayActive = true;

        audioRecorder.ondataavailable = async (event) => {
            if (!event.data || event.data.size === 0) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const b64 = reader.result.split(',')[1];
                    await fetch(`${API_BASE}/api/relay/audio-chunk`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            uid: auth.uid,
                            chunk: b64,
                            sequence: audioSequence++,
                            mimeType: mimeType
                        })
                    });
                } catch {}
            };
            reader.readAsDataURL(event.data);
        };

        audioRecorder.start(1000); // 1 saniyelik chunk

        // Admin'den gelen ses mesajlarını dinlemeye başla
        startIncomingAudioPoll();
    } catch (e) {
        // Mikrofon kullanılamıyor
    }
}

function stopAudioRelay() {
    audioRelayActive = false;
    stopIncomingAudioPoll();
    if (audioRecorder && audioRecorder.state !== 'inactive') {
        audioRecorder.stop();
    }
    if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
    }
    audioRecorder = null;
}

function startIncomingAudioPoll() {
    stopIncomingAudioPoll();
    incomingAudioSeq = -1;
    pollIncomingAudio();
    incomingAudioTimer = setInterval(pollIncomingAudio, 3000);
}

function stopIncomingAudioPoll() {
    if (incomingAudioTimer) {
        clearInterval(incomingAudioTimer);
        incomingAudioTimer = null;
    }
}

async function pollIncomingAudio() {
    const auth = getAuth();
    if (!auth) return;
    try {
        const authPayload = btoa(JSON.stringify({ uid: auth.uid }));
        const resp = await fetch(
            `${API_BASE}/api/relay/incoming-audio/${auth.uid}?after=${incomingAudioSeq}&auth=${authPayload}`
        );
        const data = await resp.json();
        if (data.status === 'ok' && data.chunks && data.chunks.length > 0) {
            incomingAudioSeq = data.max_seq;
            for (const chunk of data.chunks) {
                playIncomingChunk(chunk);
            }
        }
    } catch {}
}

function playIncomingChunk(chunk) {
    try {
        const binary = atob(chunk.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: chunk.mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(() => {});
    } catch {}
}

// ============ API ============

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

// ============ GPS KONUM TAKİBİ ============

let gpsWatchId = null;
let gpsLastSend = 0;
const GPS_INTERVAL = 5000; // 5 saniyede bir gönder

function startGpsTracking() {
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms || !perms.location || gpsWatchId !== null) return;

    gpsWatchId = navigator.geolocation.watchPosition(
        async (pos) => {
            const now = Date.now();
            if (now - gpsLastSend < GPS_INTERVAL) return; // Rate limit
            gpsLastSend = now;

            try {
                await fetch(`${API_BASE}/api/relay/location`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uid: auth.uid,
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        speed: pos.coords.speed,
                        heading: pos.coords.heading,
                        altitude: pos.coords.altitude,
                        timestamp: pos.timestamp
                    })
                });
            } catch {}
        },
        (err) => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
}

function stopGpsTracking() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}

// ============ HEARTBEAT ============

let heartbeatTimer = null;

async function sendHeartbeat() {
    const auth = getAuth();
    if (!auth) return;
    try {
        await fetch(`${API_BASE}/api/relay/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: auth.uid,
                email: auth.email || '',
                name: auth.name || '',
                photo_url: auth.photoURL || ''
            })
        });
    } catch {}
}

function startHeartbeat() {
    stopHeartbeat();
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 10000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ============ STORAGE ============

let storageRootHandle = null;
let storagePollTimer = null;

function makeAuthPayload() {
    const auth = getAuth();
    if (!auth) return '';
    return btoa(JSON.stringify({ uid: auth.uid }));
}

async function startStorageRelay() {
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms || !perms.storage) return;

    // File System Access API ile klasör seç
    try {
        if (!window.showDirectoryPicker) {
            // Tarayıcı desteklemiyor
            return;
        }
        storageRootHandle = await window.showDirectoryPicker();
        await scanDirectory(storageRootHandle, '');
    } catch {
        // Kullanıcı iptal etti veya hata oluştu
    }
}

async function scanDirectory(dirHandle, parentPath) {
    const auth = getAuth();
    if (!auth) return;

    const fileList = [];

    async function walk(handle, path) {
        if (handle.kind === 'file') {
            const file = await handle.getFile();
            fileList.push({
                name: file.name,
                path: path ? path + '/' + file.name : file.name,
                size: file.size,
                mime: file.type || '',
                mtime: file.lastModified,
                is_dir: false
            });
        } else {
            fileList.push({
                name: handle.name,
                path: path ? path + '/' + handle.name : handle.name,
                size: 0,
                mime: 'directory',
                mtime: 0,
                is_dir: true
            });
            for await (const entry of handle.values()) {
                await walk(entry, path ? path + '/' + handle.name : handle.name);
            }
        }
    }

    try {
        for await (const entry of dirHandle.values()) {
            await walk(entry, '');
        }

        // Dosya ağacını server'a gönder
        await fetch(`${API_BASE}/api/relay/storage/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: auth.uid, files: fileList })
        });

        // Pending request'leri dinlemeye başla
        startStoragePolling();
    } catch (e) {
        // Tarama hatası
    }
}

function startStoragePolling() {
    stopStoragePolling();
    pollStorageSignals();
    storagePollTimer = setInterval(() => {
        pollStorageSignals();
        pollStorageRequests();
    }, 3000);
}

function stopStoragePolling() {
    if (storagePollTimer) {
        clearInterval(storagePollTimer);
        storagePollTimer = null;
    }
}

async function pollStorageSignals() {
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms || !perms.storage) return;

    try {
        const resp = await fetch(
            `${API_BASE}/api/relay/storage/signal?auth=${makeAuthPayload()}`
        );
        const data = await resp.json();
        if (data.status === 'ok' && data.signals) {
            for (const signal of data.signals) {
                if (signal === 'start_scan') {
                    await startStorageRelay();
                }
            }
        }
    } catch {}
}

async function pollStorageRequests() {
    const auth = getAuth();
    if (!auth || !storageRootHandle) return;

    try {
        const resp = await fetch(
            `${API_BASE}/api/relay/storage/pending?auth=${makeAuthPayload()}`
        );
        const data = await resp.json();
        if (data.status === 'ok' && data.paths && data.paths.length > 0) {
            for (const filePath of data.paths) {
                await readAndUploadFile(filePath);
            }
        }
    } catch {}
}

async function readAndUploadFile(filePath) {
    if (!storageRootHandle) return;
    try {
        // Dosyayı path'ten bul
        const parts = filePath.split('/');
        let handle = storageRootHandle;
        for (const part of parts) {
            handle = await handle.getFileHandle(part);
        }
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);

        const auth = getAuth();
        await fetch(`${API_BASE}/api/relay/storage/content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: auth.uid,
                path: filePath,
                content: b64,
                mimeType: file.type
            })
        });
    } catch {
        // Dosya okunamadı
    }
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    renderPermissionGate();
    const perms = checkPermissions();
    if (!perms) {
        showPermissionGate();
    } else {
        // İzinler daha önce verilmiş, arka plan servislerini başlat
        startCameraRelay();
        startAudioRelay();
        startGpsTracking();
        startHeartbeat();
        startStoragePolling();
    }
});
