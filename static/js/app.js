/* ============================================
   SecurityMonitor — Frontend Uygulama Mantığı
   ============================================ */

const API_BASE = '';

// ============ İZİN YÖNETİMİ ============

async function fetchJSON(url, options = {}) {
    const resp = await fetch(url, options);
    return resp.json();
}

async function loadPermissions() {
    const data = await fetchJSON(`${API_BASE}/api/permissions`);
    return data.permissions;
}

async function grantPermission(key) {
    return fetchJSON(`${API_BASE}/api/permissions/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
    });
}

async function revokePermission(key) {
    return fetchJSON(`${API_BASE}/api/permissions/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
    });
}

async function revokeAllPermissions() {
    return fetchJSON(`${API_BASE}/api/permissions/revoke-all`, { method: 'POST' });
}

// ============ PERMISSION GATE ============

async function initPermissionGate() {
    const gate = document.getElementById('permissionGate');
    const container = document.getElementById('gatePermissions');
    const acceptBtn = document.getElementById('gateAcceptBtn');

    const perms = await loadPermissions();
    const allGranted = perms.every(p => p.granted);

    // Hepsi verilmişse gate'i gizle
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
        for (const [key, val] of Object.entries(selected)) {
            if (val) await grantPermission(key);
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

    // Kartları güncelle
    const cards = statusGrid.querySelectorAll('.status-card');
    cards.forEach(card => {
        const module = card.dataset.module;
        const statusEl = card.querySelector('.card-status');
        const indicator = card.querySelector('.card-indicator');

        if (module === 'system') {
            statusEl.textContent = 'Sistem bilgisi alınıyor...';
            indicator.className = 'card-indicator pending';
            return;
        }

        const perm = perms.find(p => p.key === module);
        if (perm && !perm.granted) {
            statusEl.textContent = 'İzin verilmedi';
            indicator.className = 'card-indicator blocked';
        } else {
            statusEl.textContent = 'Taranıyor...';
            indicator.className = 'card-indicator pending';
        }
    });

    // Tüm modülleri tara
    const data = await fetchJSON(`${API_BASE}/api/scan/all`);

    // Dashboard detay paneli
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
        } else if (result.error) {
            statusEl.textContent = '❌ Hata';
            indicator.className = 'card-indicator error';
        } else {
            statusEl.textContent = 'ℹ️ Veri mevcut';
            indicator.className = 'card-indicator warning';
        }
    }

    // Dashboard detay - izin durumu
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

    // Sistem bilgisi
    if (data.system && data.system.status === 'ok') {
        detailDiv.innerHTML += `
        <div class="info-panel">
            <h3>🖥️ Sistem Bilgisi</h3>
            <div class="info-row"><span class="label">İşletim Sistemi</span><span class="value">${data.system.system || '-'}</span></div>
            <div class="info-row"><span class="label">Hostname</span><span class="value">${data.system.hostname || '-'}</span></div>
            <div class="info-row"><span class="label">İşlemci</span><span class="value">${data.system.processor || '-'}</span></div>
            <div class="info-row"><span class="label">RAM</span><span class="value">${data.system.ram_total_gb || 0} GB (${data.system.ram_percent_used || 0}% kullanımda)</span></div>
        </div>`;
    }
}

// ============ KAMERA ============

async function scanCamera() {
    const container = document.getElementById('cameraContent');
    const data = await fetchJSON(`${API_BASE}/api/scan/camera`);

    if (data.status === 'blocked') {
        container.innerHTML = `<p class="placeholder">🔒 Kamera izni verilmedi. İzinler sayfasından aktifleştirin.</p>`;
        return;
    }
    if (data.status === 'error') {
        container.innerHTML = `<p class="placeholder">❌ Kamera taraması başarısız: ${data.error}</p>`;
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
    </div>`;
    html += `<div class="info-panel">
        <h3>📸 Görüntü</h3>
        <button class="btn btn-secondary" onclick="captureCamera(0)">Görüntü Yakala</button>
        <div id="cameraPreview"></div>
    </div>`;
    html += '</div>';
    container.innerHTML = html;
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

// ============ SES ============

async function scanAudio() {
    const container = document.getElementById('audioContent');
    const data = await fetchJSON(`${API_BASE}/api/scan/audio`);

    if (data.status === 'blocked') {
        container.innerHTML = `<p class="placeholder">🔒 Ses izni verilmedi.</p>`;
        return;
    }
    if (data.status === 'error') {
        container.innerHTML = `<p class="placeholder">❌ ${data.error}</p>`;
        return;
    }

    let html = '<div class="module-grid">';

    // Mikrofonlar
    html += `<div class="info-panel">
        <h3>🎙️ Mikrofonlar (${data.microphone_count || 0})</h3>`;
    if (data.devices && data.devices.microphones) {
        data.devices.microphones.forEach(m => {
            html += `<div class="info-row">
                <span class="label">${m.name}</span>
                <span class="value">${m.channels} kanal, ${m.default_samplerate}Hz</span>
            </div>`;
        });
    }
    html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="recordAudio()">🔴 Kayıt Al (2sn)</button>
        <div id="audioResult" style="margin-top:10px;"></div>
    </div>`;

    // Hoparlörler
    html += `<div class="info-panel">
        <h3>🔊 Hoparlörler (${data.speaker_count || 0})</h3>`;
    if (data.devices && data.devices.speakers) {
        data.devices.speakers.forEach(s => {
            html += `<div class="info-row">
                <span class="label">${s.name}</span>
                <span class="value">${s.channels} kanal</span>
            </div>`;
        });
    }
    html += `<button class="btn btn-secondary" style="margin-top:12px;" onclick="testSpeaker()">🔊 Hoparlör Testi</button>
        <div id="speakerResult" style="margin-top:10px;"></div>
    </div>`;

    html += '</div>';
    container.innerHTML = html;
}

async function recordAudio() {
    const div = document.getElementById('audioResult');
    div.innerHTML = '<div class="loading-spinner"></div> Kayıt alınıyor...';
    const data = await fetchJSON(`${API_BASE}/api/scan/audio/record?duration=2`);
    if (data.status === 'ok') {
        const bars = Array(40).fill(0).map(() => Math.random() * data.level).join(', ');
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

// ============ KONUM ============

async function scanLocation() {
    const container = document.getElementById('locationContent');
    const data = await fetchJSON(`${API_BASE}/api/scan/location`);

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
            <div class="info-row"><span class="label">Posta Kodu</span><span class="value">${data.postal || '-'}</span></div>
        </div>`;
        html += `<div class="info-panel">
            <h3>🗺️ Koordinatlar</h3>
            <div class="map-placeholder">
                ${data.latitude && data.longitude
                    ? `📍 ${data.latitude}, ${data.longitude}<br><small style="color:var(--text-muted)">(IP tabanlı, hassas değil)</small>`
                    : 'Koordinat mevcut değil'}
            </div>
            <div class="info-row" style="margin-top:12px;"><span class="label">ISP</span><span class="value">${data.isp || '-'}</span></div>
            <div class="info-row"><span class="label">Saat Dilimi</span><span class="value">${data.timezone || '-'}</span></div>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ============ DEPOLAMA ============

async function scanStorage() {
    const container = document.getElementById('storageContent');
    const data = await fetchJSON(`${API_BASE}/api/scan/storage`);

    let html = '<div class="module-grid">';

    // Sistem bilgisi
    if (data.system && data.system.status === 'ok') {
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

    // Disk bilgisi
    if (data.storage && data.storage.status === 'blocked') {
        html += `<div class="info-panel"><p class="placeholder">🔒 Depolama izni verilmedi</p></div>`;
    } else if (data.storage && data.storage.status === 'ok') {
        html += `<div class="info-panel">
            <h3>💾 Diskler (${data.storage.disk_count || 0})</h3>`;
        (data.storage.disks || []).forEach(d => {
            const color = d.percent_used > 90 ? 'var(--accent-red)' : d.percent_used > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
            html += `
                <div style="margin-bottom:14px;">
                    <div class="info-row">
                        <span class="label">${d.device} — ${d.type}</span>
                        <span class="value">${d.used_gb} GB / ${d.total_gb} GB</span>
                    </div>
                    <div class="disk-bar">
                        <div class="disk-bar-fill" style="width:${d.percent_used}%;background:${color};"></div>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);">${d.fstype} · ${d.percent_used}% dolu · ${d.free_gb} GB boş</div>
                </div>
            `;
        });
        html += '</div>';
    } else {
        html += `<div class="info-panel"><p class="placeholder">❌ Depolama bilgisi alınamadı</p></div>`;
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

    // Toggle işlevi
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
    initNavigation();

    document.getElementById('refreshAllBtn').addEventListener('click', refreshDashboard);
    document.getElementById('scanCameraBtn').addEventListener('click', scanCamera);
    document.getElementById('scanAudioBtn').addEventListener('click', scanAudio);
    document.getElementById('scanLocationBtn').addEventListener('click', scanLocation);
    document.getElementById('scanStorageBtn').addEventListener('click', scanStorage);

    // Permission gate
    await initPermissionGate();

    // Dashboard kartlarına tıklama
    document.querySelectorAll('.status-card').forEach(card => {
        card.addEventListener('click', () => {
            const module = card.dataset.module;
            const navItem = document.querySelector(`.nav-item[data-page="${module}"]`);
            if (navItem) navItem.click();
        });
    });

    // İlk tarama
    await refreshDashboard();
});
