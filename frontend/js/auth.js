/**
 * BLANJAAN v2.0 — Authentication & Session Management
 */

let authCheckGeneration = 0;
let passwordResetEmail = '';

function getAuthSnapshot() {
    try {
        const raw = localStorage.getItem(AUTH_SNAPSHOT_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.user ? parsed : null;
    } catch (_) { return null; }
}

function saveAuthSnapshot() {
    try {
        if (!authState.user) return;
        localStorage.setItem(AUTH_SNAPSHOT_KEY, JSON.stringify({
            user: authState.user,
            seller: authState.seller || null,
            sellerApplication: authState.sellerApplication || null,
            savedAt: Date.now()
        }));
    } catch (_) {}
}

function restoreAuthSnapshot(token) {
    if (!token) return false;
    const snap = getAuthSnapshot();
    if (!snap || !snap.user) return false;
    authState.user = snap.user;
    authState.seller = snap.seller || null;
    authState.sellerApplication = snap.sellerApplication || null;
    authState.sessionToken = token;
    authState.status = 'AUTHENTICATED';
    return true;
}

function getStoredToken() {
    const now = Date.now();
    const candidates = [
        { token: localStorage.getItem(SESSION_KEY), meta: localStorage.getItem(SESSION_META_KEY), store: localStorage },
        { token: sessionStorage.getItem(SESSION_KEY), meta: sessionStorage.getItem(SESSION_META_KEY), store: sessionStorage }
    ];
    for (const item of candidates) {
        if (!item.token) continue;
        try {
            const meta = item.meta ? JSON.parse(item.meta) : {};
            const expiresAt = Number(meta.expiresAt || 0);
            const lastActivity = Number(meta.lastActivity || 0);
            if (expiresAt && expiresAt <= now) {
                item.store.removeItem(SESSION_KEY);
                item.store.removeItem(SESSION_META_KEY);
                continue;
            }
            if (lastActivity && now - lastActivity > IDLE_TIMEOUT_MS) {
                item.store.removeItem(SESSION_KEY);
                item.store.removeItem(SESSION_META_KEY);
                continue;
            }
        } catch (_) {}
        return item.token;
    }
    return null;
}

function saveSession(token, expiresAt, rememberMe) {
    const meta = { expiresAt: new Date(expiresAt).getTime(), lastActivity: Date.now(), rememberMe: !!rememberMe };
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_META_KEY);
    sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_META_KEY);
    const store = rememberMe ? localStorage : sessionStorage;
    store.setItem(SESSION_KEY, token);
    store.setItem(SESSION_META_KEY, JSON.stringify(meta));
}

function touchSessionActivity(force = false) {
    const now = Date.now();
    if (!force && now - lastActivityPersistAt < 15000) return;
    lastActivityPersistAt = now;
    [localStorage, sessionStorage].forEach(store => {
        const token = store.getItem(SESSION_KEY);
        if (!token) return;
        try {
            const meta = JSON.parse(store.getItem(SESSION_META_KEY) || '{}');
            meta.lastActivity = now;
            store.setItem(SESSION_META_KEY, JSON.stringify(meta));
        } catch (_) {}
    });
}

function clearSessionStorage(clearSnapshot = true) {
    localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_META_KEY);
    sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_META_KEY);
    if (clearSnapshot) localStorage.removeItem(AUTH_SNAPSHOT_KEY);
    authState.user = null;
    authState.seller = null;
    authState.sellerApplication = null;
    authState.sellerServices = [];
    authState.sessionToken = null;
    authState.status = "GUEST";
}

function initIdleSessionGuard() {
    ['click', 'keydown', 'touchstart', 'scroll', 'pointerdown'].forEach(evt =>
        document.addEventListener(evt, () => touchSessionActivity(false), { passive: true })
    );
    setInterval(() => {
        if (authState.status !== 'AUTHENTICATED') return;
        const now = Date.now();
        const metaRaw = localStorage.getItem(SESSION_META_KEY) || sessionStorage.getItem(SESSION_META_KEY) || '{}';
        let meta = {};
        try { meta = JSON.parse(metaRaw); } catch (_) {}
        const lastActivity = Number(meta.lastActivity || 0);
        if (lastActivity && now - lastActivity > IDLE_TIMEOUT_MS) {
            clearSessionStorage();
            renderAccountState();
            renderHomeHeaderAuth();
            showToast('Sesi berakhir karena tidak ada aktivitas selama 30 menit.', true);
            return;
        }
        const token = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        if (!token) {
            clearSessionStorage();
            renderAccountState();
            renderHomeHeaderAuth();
        }
    }, 15000);
}

function hasAdminRoleClient() {
    if (!authState.user || !authState.user.roles) return false;
    return (authState.user.roles || []).some(r => ['ADMIN', 'SUPERADMIN'].includes(String(r).toUpperCase()));
}

function renderHomeHeaderAuth() {
    const greeting = document.getElementById('home-user-greeting');
    const reg = document.getElementById('home-guest-register');
    const login = document.getElementById('home-guest-login');
    const authenticated = authState.status === 'AUTHENTICATED' && authState.user;
    if (!greeting || !reg || !login) return;
    if (authenticated) {
        const name = (authState.user.display_name || 'Pengguna').trim();
        greeting.textContent = `Halo, ${name}`;
        greeting.classList.remove('hidden');
        reg.classList.add('hidden');
        login.classList.add('hidden');
    } else {
        greeting.classList.add('hidden');
        reg.classList.remove('hidden');
        login.classList.remove('hidden');
    }
}

async function checkAuthSession() {
    const generation = ++authCheckGeneration;
    const token = getStoredToken();
    if (!token) {
        authState.status = "GUEST";
        renderAccountState();
        return;
    }

    const restored = restoreAuthSnapshot(token);
    if (restored) {
        renderAccountState();
        renderHomeHeaderAuth();
    }

    try {
        const data = await fetchAPI("authMe", { session_token: token });
        if (generation !== authCheckGeneration) return;
        authState.user = data.user;
        authState.seller = data.seller || null;
        authState.sellerApplication = data.seller_application || null;
        authState.sellerServices = data.seller_services || [];
        authState.sessionToken = token;
        authState.status = "AUTHENTICATED";
        const storedMeta = (() => {
            try { return JSON.parse(localStorage.getItem(SESSION_META_KEY) || sessionStorage.getItem(SESSION_META_KEY) || '{}'); }
            catch (_) { return {}; }
        })();
        saveSession(token, data.expires_at || (getAuthSnapshot()?.expiresAt || Date.now() + 30 * 86400000), !!storedMeta.rememberMe);
        saveAuthSnapshot();
        touchSessionActivity(true);
        await hydrateServerCart();
        if (typeof hydrateRecentOutboundOrdersFromServer === 'function') {
            await hydrateRecentOutboundOrdersFromServer();
        }
    } catch (e) {
        if (generation !== authCheckGeneration) return;
        const msg = String(e?.message || '');
        if (/sesi (tidak ditemukan|sudah tidak aktif|sudah kedaluwarsa)|sesi tidak valid/i.test(msg)) {
            clearSessionStorage(true);
            renderAccountState();
            renderHomeHeaderAuth();
        } else if (!restored) {
            authState.status = 'GUEST';
            renderAccountState();
        }
        if (restored) {
            try { renderAccountState(); renderHomeHeaderAuth(); updateCartBadge(); } catch (_) {}
        }
    }
    if (authState.status === 'AUTHENTICATED') {
        renderAccountState();
        renderHomeHeaderAuth();
        void renderAccountOrderHistory();
    }
}

async function validateCurrentSession() {
    const token = authState.sessionToken;
    if (!token) throw new Error('Sesi tidak valid. Silakan login kembali.');
    return fetchAPI('authValidateSession', { session_token: token });
}

function formatWhatsAppForDisplay(phone) {
    const n = normalizeWhatsAppNumber(phone);
    return n ? '+' + n : (phone || '-');
}

function profileInitialImage(user) {
    const src = String(user?.profile_image || '').trim();
    if (!src) return 'https://placehold.co/128x128/e5e7eb/6b7280?text=U';
    const driveId = (src.match(/[?&]id=([a-zA-Z0-9_-]+)/) || src.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (driveId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w400`;
    return src;
}

function applyProfileImage(src) {
    const normalized = String(src || '').trim();
    if (!normalized) return showToast('Link gambar belum diisi.', true);
    if (!/^https?:\/\//i.test(normalized)) return showToast('Link gambar harus berupa URL http/https.', true);
    const img = document.getElementById('edit-profile-preview');
    if (img) {
        img.src = profileInitialImage({ profile_image: normalized });
        img.onerror = () => showToast('Preview gambar gagal dimuat. Pastikan URL gambar dapat diakses publik.', true);
    }
    if (authState.user) authState.user.profile_image = normalized;
}

async function uploadProfileImageFile(file, inputEl) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('File harus berupa gambar.', true);
    if (file.size > 3 * 1024 * 1024) return showToast('Ukuran gambar maksimal 3 MB.', true);
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const dataUrl = String(reader.result || '');
            const comma = dataUrl.indexOf(',');
            const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
            const res = await fetchAPI('uploadProfileImage', { session_token: authState.sessionToken, data_base64: base64, mime_type: file.type, filename: file.name });
            if (res && res.user) authState.user = res.user;
            else if (res && res.profile_image) authState.user.profile_image = res.profile_image;
            const urlInput = document.getElementById('edit-profile-image-url');
            if (urlInput && authState.user?.profile_image) urlInput.value = authState.user.profile_image;
            renderAccountState();
            renderHomeHeaderAuth();
            showToast('Foto profil berhasil diperbarui.');
        } catch (err) { showToast(err.message, true); }
        finally { if (inputEl) inputEl.value = ''; }
    };
    reader.onerror = () => showToast('Gagal membaca file gambar.', true);
    reader.readAsDataURL(file);
}

async function renderAccountOrderHistory() {
    const c = document.getElementById('account-order-history');
    if (!c || authState.status !== 'AUTHENTICATED') return;
    try {
        const orders = await fetchAPI('getMyOrders', { session_token: authState.sessionToken });
        const contacted = (Array.isArray(orders) ? orders : []).filter(o => String(o.status || '').toUpperCase() === 'CONTACTED').slice(0, 20);
        if (!contacted.length) {
            c.innerHTML = '<div class="text-xs text-gray-400 text-center py-3">Belum ada pesanan yang dikirim via WhatsApp.</div>';
            return;
        }
        c.innerHTML = contacted.map(o => {
            const rated = !o.can_rate;
            const items = (o.items || []).map(i => `${escapeHTML(i.name)} ×${Number(i.qty || 0)}`).join(', ');
            return `<div class="border rounded-lg p-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="font-bold text-sm text-gray-800">${escapeHTML(o.seller_name || 'Toko')}</div><div class="text-xs text-gray-500 mt-1 truncate">${items}</div><div class="text-[10px] text-green-600 font-bold mt-1">Terkirim via WhatsApp · ${escapeHTML(new Date(o.whatsapp_opened_at || o.created_at).toLocaleString('id-ID'))}</div></div><button ${rated ? 'disabled' : ''} data-action="openRating" data-payload="${escapeHTML(o.seller_id)}" data-payload2="${escapeHTML(o.seller_name || 'Toko')}" data-payload3="${escapeHTML(o.order_id)}" class="px-3 py-2 rounded-lg text-xs font-bold ${rated ? 'bg-gray-100 text-gray-400' : 'bg-orange-50 text-primary'}">${rated ? 'Sudah Dinilai' : 'Nilai'}</button></div><div class="text-xs font-bold text-primary mt-2">${formatRupiah(o.total || 0)} · ${Number(o.total_items || 0)} barang</div></div>`;
        }).join('');
        lucide.createIcons();
    } catch (e) {
        c.innerHTML = '<div class="text-xs text-red-500 text-center py-3">Gagal memuat riwayat pesanan.</div>';
    }
}

function renderAccountState() {
    renderHomeHeaderAuth();
    const container = document.getElementById('account-state-container');
    const headerTitle = document.getElementById('account-header-title');
    if (!container) return;
    if (typeof renderRepurchaseSection === 'function') renderRepurchaseSection();

    if (authState.status === "LOADING") {
        container.innerHTML = `<div class="pt-20 flex flex-col items-center"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-gray-400"></i></div>`;
    } else if (authState.status === "GUEST") {
        if (headerTitle) headerTitle.textContent = "Akun";
        container.innerHTML = '';
        container.appendChild(document.getElementById('tpl-auth-guest').content.cloneNode(true));
        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            if (!email) return;
            const btn = document.getElementById('btnLoginContinue');
            btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Memeriksa...`;
            btn.disabled = true;
            try {
                const res = await fetchAPI('authCheckLoginMethod', { email });
                pendingLoginEmail = email;
                if (res && res.exists && res.has_password) {
                    renderPasswordLoginState(email);
                } else {
                    const otpRes = await fetchAPI('authRequestOtp', { email });
                    renderOtpState(otpRes.resend_after_seconds || 60);
                }
            } catch (err) {
                showToast(err.message, true);
                btn.innerHTML = `Lanjutkan`;
                btn.disabled = false;
            } finally { lucide.createIcons(); }
        });
    } else if (authState.status === "AUTHENTICATED") {
        if (headerTitle) headerTitle.textContent = "Profil Saya";
        container.innerHTML = '';
        container.appendChild(document.getElementById('tpl-account-profile').content.cloneNode(true));
        document.getElementById('prof-name').textContent = authState.user.display_name || "Pengguna";
        document.getElementById('prof-email').textContent = authState.user.email;
        const profAvatar = document.getElementById('prof-avatar');
        if (profAvatar) profAvatar.src = profileInitialImage(authState.user);
        const profileInput = document.getElementById('profile-image-file');
        if (profileInput) profileInput.addEventListener('change', e => uploadProfileImageFile(e.target.files[0], profileInput));
        document.getElementById('prof-wa').textContent = formatWhatsAppForDisplay(authState.user.phone);
        document.getElementById('prof-city').textContent = authState.user.city || "-";
        document.getElementById('prof-address').textContent = authState.user.address || "Belum ada alamat pengiriman diatur.";

        let rolesHtml = '';
        (authState.user.roles || []).forEach(r => {
            rolesHtml += `<span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold border">${escapeHTML(r)}</span>`;
        });
        document.getElementById('prof-roles').innerHTML = rolesHtml;
        const adminSection = document.getElementById('prof-admin-section');
        if (adminSection) adminSection.classList.toggle('hidden', !hasAdminRoleClient());
        const sellerStatusCont = document.getElementById('prof-seller-status');
        const passwordStatus = document.getElementById('prof-password-status');
        if (passwordStatus) {
            passwordStatus.textContent = authState.user.has_password ? 'Password aktif' : 'Belum dibuat';
            passwordStatus.className = authState.user.has_password ? 'text-[10px] font-bold text-green-600' : 'text-[10px] font-bold text-orange-600';
        }

        if (authState.seller) {
            const statusColor = authState.seller.status === 'ACTIVE' ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-100';
            sellerStatusCont.innerHTML = `<div class="flex items-center gap-3"><div class="w-10 h-10 bg-orange-100 text-primary rounded flex items-center justify-center"><i data-lucide="store" class="w-5 h-5"></i></div><div><div class="font-bold text-sm text-gray-800">${escapeHTML(authState.seller.store_name)}</div><div class="text-[10px] font-bold px-2 py-0.5 rounded mt-1 inline-block ${statusColor}">Status: ${authState.seller.status === 'ACTIVE' ? 'Toko Aktif' : escapeHTML(authState.seller.status)}</div></div></div>`;
            if (authState.seller.status === 'ACTIVE') {
                sellerStatusCont.innerHTML += `<button data-action="openSellerDashboard" class="mt-4 w-full bg-green-50 text-green-700 border border-green-200 font-bold py-2.5 rounded-md text-sm hover:bg-green-100 transition flex justify-center items-center gap-2"><i data-lucide="layout-dashboard" class="w-4 h-4 pointer-events-none"></i> Buka Dashboard Penjual</button>`;
            }
        } else if (authState.sellerApplication) {
            const app = authState.sellerApplication;
            const st = String(app.status || 'PENDING').toUpperCase();
            const statusClass = st === 'REJECTED' ? 'text-red-600 bg-red-50' : 'text-orange-600 bg-orange-50';
            const label = st === 'REJECTED' ? 'Ditolak' : 'Menunggu persetujuan admin';
            sellerStatusCont.innerHTML = `<div class="flex items-center gap-3"><div class="w-10 h-10 bg-orange-100 text-primary rounded flex items-center justify-center"><i data-lucide="store" class="w-5 h-5"></i></div><div><div class="font-bold text-sm text-gray-800">${escapeHTML(app.store_name || 'Pengajuan Toko')}</div><div class="text-[10px] font-bold px-2 py-0.5 rounded mt-1 inline-block ${statusClass}">${label}</div></div></div>`;
        } else {
            if (hasAdminRoleClient()) {
                sellerStatusCont.innerHTML = `<div class="text-xs text-gray-500">Akun ADMIN tidak memiliki menu pembukaan toko.</div>`;
            } else {
                sellerStatusCont.innerHTML = `<div class="text-xs text-gray-500 mb-2">Anda belum memiliki toko.</div><button data-action="startMitraFlow" class="text-xs border border-primary text-primary px-4 py-2 rounded-md font-bold active:bg-orange-50 w-full flex justify-center items-center gap-1"><i data-lucide="plus-circle" class="w-4 h-4 pointer-events-none"></i> Buka Toko Sekarang</button>`;
            }
        }
        void renderAccountOrderHistory();
    }
    lucide.createIcons();
}

function renderPasswordLoginState(email) {
    const container = document.getElementById('account-state-container');
    container.innerHTML = '';
    container.appendChild(document.getElementById('tpl-auth-password').content.cloneNode(true));
    document.getElementById('password-login-email').textContent = email;
    document.getElementById('form-password-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('loginPassword').value;
        const rememberMe = document.getElementById('loginRememberMe').checked;
        const btn = document.getElementById('btnLoginPassword');
        if (!password) return;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Masuk...`;
        btn.disabled = true;
        try {
            const res = await fetchAPI('authLoginPassword', { email, password, remember_me: rememberMe });
            if (!res || !res.session_token || !res.user) throw new Error('Login berhasil tetapi sesi tidak diterima oleh aplikasi.');
            saveSession(res.session_token, res.expires_at, rememberMe);
            authState.user = res.user;
            authState.seller = res.seller || null;
            authState.sellerApplication = res.seller_application || null;
            authState.sellerServices = res.seller_services || [];
            authCheckGeneration++;
            authState.sessionToken = res.session_token;
            authState.status = 'AUTHENTICATED';
            saveAuthSnapshot();
            void hydrateServerCart();
            if (intentAfterLogin) { const target = intentAfterLogin; intentAfterLogin = null; switchView(target); }
            else renderAccountState();
            showToast('Berhasil masuk.');
        } catch (err) {
            showToast(err.message, true);
        } finally {
            btn.innerHTML = `Masuk`;
            btn.disabled = false;
            lucide.createIcons();
        }
    });
    lucide.createIcons();
}

function renderOtpState(cooldownSec) {
    const container = document.getElementById('account-state-container');
    container.innerHTML = '';
    container.appendChild(document.getElementById('tpl-auth-otp').content.cloneNode(true));
    document.getElementById('otp-target-email').textContent = pendingLoginEmail;
    const btnVerify = document.getElementById('btnVerifyOtp');
    const btnResend = document.getElementById('btnResendOtp');
    const timerSpan = document.getElementById('resend-timer');
    startResendTimer(cooldownSec, btnResend, timerSpan);
    btnResend.addEventListener('click', async () => {
        btnResend.disabled = true;
        timerSpan.textContent = "(Memproses...)";
        try {
            const res = await fetchAPI('authRequestOtp', { email: pendingLoginEmail });
            startResendTimer(res.resend_after_seconds || 60, btnResend, timerSpan);
            showToast("Kode baru telah dikirim.");
        } catch (err) {
            showToast(err.message, true);
            startResendTimer(15, btnResend, timerSpan);
        }
    });
    document.getElementById('form-verify-otp').addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = document.getElementById('otpInput').value.trim();
        const rememberMe = document.getElementById('rememberMe').checked;
        if (otp.length !== 6) return;
        btnVerify.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Verifikasi...`;
        btnVerify.disabled = true;
        try {
            const res = await fetchAPI('authVerifyOtp', { email: pendingLoginEmail, otp, remember_me: rememberMe });
            if (!res || !res.session_token || !res.user) throw new Error('Login berhasil tetapi sesi tidak diterima oleh aplikasi.');
            saveSession(res.session_token, res.expires_at, rememberMe);
            authState.user = res.user;
            authState.seller = res.seller || null;
            authState.sellerApplication = res.seller_application || null;
            authState.sellerServices = res.seller_services || [];
            authCheckGeneration++;
            authState.sessionToken = res.session_token;
            authState.status = 'AUTHENTICATED';
            saveAuthSnapshot();
            void hydrateServerCart();
            await ensurePasswordPromptAfterLogin();
            if (intentAfterLogin) { const target = intentAfterLogin; intentAfterLogin = null; switchView(target); }
            else renderAccountState();
            showToast('Berhasil masuk.');
        } catch (err) {
            showToast(err.message, true);
            btnVerify.innerHTML = `Verifikasi & Masuk`;
            btnVerify.disabled = false;
        }
    });
    lucide.createIcons();
}

function startResendTimer(sec, btn, span) {
    clearInterval(resendInterval);
    let remain = sec;
    btn.disabled = true;
    span.textContent = `(${remain}s)`;
    resendInterval = setInterval(() => {
        remain--;
        if (remain <= 0) {
            clearInterval(resendInterval);
            btn.disabled = false;
            span.textContent = "";
        } else span.textContent = `(${remain}s)`;
    }, 1000);
}

function openPasswordModal(mode = 'set') {
    const modal = document.getElementById('modal-password');
    const box = modal?.querySelector(':scope > div');
    if (!modal || !box) return;
    const title = document.getElementById('password-modal-title');
    document.getElementById('password-step-form').classList.toggle('hidden', mode === 'reset');
    document.getElementById('password-step-otp').classList.toggle('hidden', mode !== 'reset');
    title.textContent = mode === 'reset' ? 'Reset Password via OTP' : (authState.user?.has_password ? 'Ubah Password' : 'Buat Password');
    modal.dataset.mode = mode;
    modal.classList.remove('hidden', 'pointer-events-none');
    setTimeout(() => { modal.classList.remove('opacity-0'); box.classList.remove('translate-y-full', 'scale-95'); }, 10);
}

function closePasswordModal() {
    const modal = document.getElementById('modal-password');
    const box = modal?.querySelector(':scope > div');
    if (!modal || !box) return;
    modal.classList.add('opacity-0');
    box.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => modal.classList.add('hidden', 'pointer-events-none'), 250);
}

async function ensurePasswordPromptAfterLogin() {
    if (authState.status === 'AUTHENTICATED' && authState.user && !authState.user.has_password) {
        setTimeout(() => { openPasswordModal('set'); showToast('Silakan buat password untuk keamanan akun.'); }, 300);
    }
}

async function requestPasswordReset() {
    const email = authState.user?.email || pendingLoginEmail || document.getElementById('loginEmail')?.value?.trim();
    if (!email) return showToast('Email belum tersedia.', true);
    try {
        await fetchAPI('requestPasswordReset', { email });
        passwordResetEmail = email;
        document.getElementById('password-otp-email').textContent = email;
        openPasswordModal('reset');
        showToast('OTP reset password telah dikirim ke email.');
    } catch (err) { showToast(err.message, true); }
}

async function savePassword(e) {
    e.preventDefault();
    const a = document.getElementById('passwordInput').value;
    const b = document.getElementById('passwordConfirm').value;
    if (a.length < 8) return showToast('Password minimal 8 karakter.', true);
    if (a !== b) return showToast('Konfirmasi password tidak sama.', true);
    const btn = document.getElementById('btn-save-password');
    btn.disabled = true;
    try {
        const res = await fetchAPI('setPassword', { session_token: authState.sessionToken, password: a });
        authState.user.has_password = !!res.has_password;
        closePasswordModal();
        showToast('Password berhasil dibuat/diperbarui.');
        renderAccountState();
    } catch (err) { showToast(err.message, true); }
    finally { btn.disabled = false; }
}

async function resetPassword(e) {
    e.preventDefault();
    const otp = document.getElementById('passwordOtpInput').value.trim();
    const a = document.getElementById('resetPasswordInput').value;
    const b = document.getElementById('resetPasswordConfirm').value;
    if (!/^\d{6}$/.test(otp)) return showToast('OTP harus 6 digit.', true);
    if (a.length < 8) return showToast('Password minimal 8 karakter.', true);
    if (a !== b) return showToast('Konfirmasi password tidak sama.', true);
    const btn = document.getElementById('btn-reset-password');
    btn.disabled = true;
    try {
        await fetchAPI('verifyPasswordResetOtp', { email: passwordResetEmail, otp, password: a });
        closePasswordModal();
        showToast('Password berhasil direset. Silakan login dengan password baru.');
        if (authState.sessionToken) {
            try {
                const me = await fetchAPI('authMe', { session_token: authState.sessionToken });
                authState.user = me.user;
                renderAccountState();
            } catch (_) {}
        } else {
            switchView('view-account');
            renderAccountState();
        }
    } catch (err) { showToast(err.message, true); }
    finally { btn.disabled = false; }
}

function closePasswordFromOutside(e) {
    if (e.target.id === 'modal-password') closePasswordModal();
}

function renderEditProfile() {
    const container = document.getElementById('account-state-container');
    document.getElementById('account-header-title').textContent = "Profil Saya";
    container.innerHTML = '';
    container.appendChild(document.getElementById('tpl-account-edit').content.cloneNode(true));

    document.getElementById('editEmail').value = authState.user.email;
    document.getElementById('editName').value = authState.user.display_name || "";
    document.getElementById('editWa').value = normalizeWhatsAppNumber(authState.user.phone) || "";
    const editPreview = document.getElementById('edit-profile-preview');
    if (editPreview) editPreview.src = profileInitialImage(authState.user);
    document.getElementById('editCity').value = authState.user.city || "";
    document.getElementById('editAddress').value = authState.user.address || "";
    const editProfileInput = document.getElementById('edit-profile-image-file');
    if (editProfileInput) editProfileInput.addEventListener('change', e => uploadProfileImageFile(e.target.files[0], editProfileInput));

    document.getElementById('form-edit-profile').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveProfile');
        btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Menyimpan...`;
        btn.disabled = true;

        const payload = {
            session_token: authState.sessionToken,
            display_name: document.getElementById('editName').value.trim(),
            phone: normalizeWhatsAppNumber(document.getElementById('editWa').value.trim()) || '',
            city: document.getElementById('editCity').value.trim(),
            address: document.getElementById('editAddress').value.trim(),
            profile_image: (document.getElementById('edit-profile-image-url')?.value || authState.user.profile_image || '').trim()
        };

        try {
            await validateCurrentSession();
            const res = await fetchAPI('updateMyProfile', payload);
            authState.user = res.user;
            if (payload.address) authState.user.address = payload.address;
            showToast("Profil diperbarui.");
            renderAccountState();
        } catch (err) {
            showToast(err.message, true);
            btn.innerHTML = `Simpan Perubahan`;
            btn.disabled = false;
        }
    });
    lucide.createIcons();
}

async function handleLogout() {
    const token = authState.sessionToken;
    const btn = document.querySelector('[data-action="doLogout"]');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-70', 'cursor-not-allowed'); }
    try {
        if (token) await fetchAPI('authLogout', { session_token: token });
    } catch (e) {
        console.warn('[Logout] server logout gagal:', e?.message || e);
    } finally {
        clearSessionStorage();
        renderAccountState();
        showToast("Anda telah keluar.");
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-70', 'cursor-not-allowed'); }
    }
}
