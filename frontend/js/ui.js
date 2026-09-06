/**
 * BLANJAAN v2.0 — UI Helpers, View Switcher, Modals & Navigation
 */

function showToast(msg, isError = false) {
    const exist = document.getElementById('global-toast');
    if (exist) exist.remove();
    const toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = `fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${isError ? 'bg-red-600' : 'bg-black bg-opacity-80'} text-white px-5 py-3 rounded-lg text-sm md:text-base z-[100] shadow-2xl flex items-center gap-2 max-w-[80%] text-center border ${isError ? 'border-red-800' : 'border-gray-700'}`;
    toast.innerHTML = `<i data-lucide="${isError ? 'alert-circle' : 'info'}" class="w-5 h-5 flex-shrink-0"></i> <span>${escapeHTML(msg)}</span>`;
    document.body.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { if (document.body.contains(toast)) toast.remove(); }, 3000);
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    const bottomNav = document.getElementById('bottom-nav');
    if (['view-product', 'view-seller', 'view-seller-dashboard', 'view-search', 'view-mitra', 'view-category', 'view-admin-dashboard'].includes(viewId)) {
        if (bottomNav) bottomNav.classList.add('hidden');
    } else {
        if (bottomNav) bottomNav.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(el => {
            const icon = el.querySelector('.nav-icon');
            if (icon) { icon.classList.remove('text-primary', 'fill-orange-100'); icon.classList.add('text-gray-400'); }
            const text = el.querySelector('.nav-text');
            if (text) { text.classList.remove('text-primary'); text.classList.add('text-gray-500'); }
        });

        let activeIndex = 0;
        if (viewId === 'view-home') activeIndex = 0;
        else if (viewId === 'view-new') activeIndex = 1;
        else if (viewId === 'view-cart') activeIndex = 2;
        else if (viewId === 'view-nearby') activeIndex = 3;
        else if (viewId === 'view-account') activeIndex = 4;

        const activeNav = document.querySelectorAll('.nav-item')[activeIndex];
        if (activeNav) {
            const icon = activeNav.querySelector('.nav-icon');
            if (icon) { icon.classList.add('text-primary', 'fill-orange-100'); icon.classList.remove('text-gray-400'); }
            const text = activeNav.querySelector('.nav-text');
            if (text) { text.classList.add('text-primary'); text.classList.remove('text-gray-500'); }
        }
    }

    if (viewId === 'view-cart') renderOrderList();
    if (viewId === 'view-new') renderNewestProducts();
    if (viewId === 'view-nearby') renderNearbyStores();
    if (viewId === 'view-seller-dashboard' && typeof startSellerDashboardAutoRefresh === 'function') {
        startSellerDashboardAutoRefresh();
    }
    window.scrollTo(0, 0);
}

function handleMitraNav() {
    if (hasAdminRoleClient()) return showToast('Akun ADMIN tidak dapat membuka toko.', true);
    if (authState.status === "AUTHENTICATED") switchView('view-mitra');
    else {
        intentAfterLogin = 'view-mitra';
        switchView('view-account');
        showToast("Silakan login terlebih dahulu.", true);
    }
}

async function submitMitra(e) {
    e.preventDefault();
    if (authState.status !== "AUTHENTICATED") return showToast("Sesi tidak valid.", true);

    const storeName = document.getElementById('mitraStore').value;
    const wa = document.getElementById('mitraWa').value;
    const category = document.getElementById('mitraCategory').value;
    const city = document.getElementById('mitraCity').value;
    const btn = document.getElementById('btnSubmitMitra');
    const originalBtnHtml = btn.innerHTML;

    btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto text-white"></i>`;
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        const res = await fetchAPI("submitSeller", {
            session_token: authState.sessionToken,
            store_name: storeName,
            wa: wa,
            category: category,
            city: city,
            description: ""
        });
        authState.sellerApplication = { application_id: res.application_id, store_name: storeName, status: res.status || 'PENDING' };
        showToast("Pengajuan berhasil dikirim! Menunggu persetujuan admin.");
        e.target.reset();
        renderAccountState();
        setTimeout(() => switchView('view-account'), 2000);
    } catch (error) {
        showToast(error.message, true);
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
        lucide.createIcons();
    }
}

function executeSearch(query) {
    const q = normalizeText(query.toLowerCase());
    if (!q) return;
    document.getElementById('search-query-display').textContent = `Menampilkan hasil untuk: "${query}"`;
    switchView('view-search');
    const container = document.getElementById('search-results-container');
    container.innerHTML = renderProdSkeleton(8);

    setTimeout(() => {
        const filtered = liveProducts.filter(p => {
            const s = sellerCache[p.seller_id];
            return p.product_name.toLowerCase().includes(q) ||
                p.product_category.toLowerCase().includes(q) ||
                (s && s.name.toLowerCase().includes(q));
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-16"><i data-lucide="search-x" class="w-12 h-12 text-gray-300 mx-auto mb-3"></i><p class="text-gray-500 text-sm">Tidak ada produk yang cocok dengan "${escapeHTML(query)}".</p></div>`;
        } else {
            let html = '';
            filtered.forEach(p => html += createProductCard(p));
            container.innerHTML = html;
        }
        lucide.createIcons();
    }, 400);
}

function renderNewestProducts() {
    const container = document.getElementById('newest-products-container');
    if (!container) return;
    container.innerHTML = renderProdSkeleton(8);
    setTimeout(() => {
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        let newest = liveProducts.filter(p => {
            if (!p.upload_date) return false;
            const uploadTime = new Date(p.upload_date).getTime();
            return (now - uploadTime) <= fourteenDaysMs;
        }).sort((a, b) => new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime());

        if (newest.length === 0) {
            container.innerHTML = `<div class="col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-20"><i data-lucide="sparkles" class="w-16 h-16 mx-auto mb-4 text-gray-300"></i><p class="text-gray-500 text-sm">Belum ada produk baru dalam 14 hari terakhir.</p></div>`;
        } else {
            let html = '';
            newest.forEach(p => html += createProductCard(p));
            container.innerHTML = html;
        }
        lucide.createIcons();
    }, 400);
}

function renderNearbyStores() {
    const container = document.getElementById('nearby-stores-container');
    if (!container) return;
    container.innerHTML = `<div class="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 skeleton h-24 mb-3"></div>`.repeat(5);

    setTimeout(() => {
        if (authState.status !== 'AUTHENTICATED' || !authState.user || !authState.user.city) {
            container.innerHTML = `<div class="text-center py-20 px-4 text-gray-500"><i data-lucide="map-pin-off" class="w-16 h-16 mx-auto mb-4 text-gray-300"></i><p class="mb-4">Silakan login dan atur Kota Anda di Menu Profil untuk melihat toko di sekitar.</p><button data-action="switchView" data-payload="view-account" class="text-xs bg-primary text-white hover:bg-primaryDark transition px-6 py-2.5 rounded-full font-bold shadow-sm active:scale-95">Atur Profil</button></div>`;
            lucide.createIcons();
            return;
        }

        const userCity = authState.user.city.toLowerCase();
        const sellers = Object.values(sellerCache).filter(s => s.location && s.location.toLowerCase() === userCity);

        if (sellers.length === 0) {
            container.innerHTML = `<div class="text-center py-20 px-4 text-gray-500"><i data-lucide="map-pin-off" class="w-16 h-16 mx-auto mb-4 text-gray-300"></i><p>Belum ada toko UMKM yang terdaftar di ${escapeHTML(authState.user.city)}.</p></div>`;
        } else {
            let html = '';
            sellers.forEach(s => {
                const logoImg = s.logo || `https://placehold.co/100x100/FF6B00/ffffff?text=${encodeURIComponent(s.name.substring(0, 2))}`;
                html += `
                <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-5 flex items-center justify-between hover:shadow-md transition">
                    <div class="flex items-center gap-3 md:gap-4">
                        <div class="w-14 h-14 md:w-16 md:h-16 bg-orange-50 rounded-full flex items-center justify-center text-primary border border-orange-100 overflow-hidden flex-shrink-0 shadow-inner">
                            <img src="${logoImg}" class="w-full h-full object-cover">
                        </div>
                        <div>
                            <div class="font-bold text-gray-800 text-sm md:text-base flex items-center gap-1">${escapeHTML(s.name)} <i data-lucide="badge-check" class="w-4 h-4 text-blue-500 fill-blue-50"></i></div>
                            <div class="text-xs text-gray-500 flex items-center mt-1"><i data-lucide="map-pin" class="w-3 h-3 mr-1 text-gray-400"></i> ${escapeHTML(s.location)}</div>
                            <div class="text-[10px] text-green-700 mt-1.5 font-bold bg-green-50 px-2 py-0.5 rounded border border-green-200 inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Buka</div>
                        </div>
                    </div>
                    <button data-action="openSeller" data-payload="${escapeHTML(s.seller_id)}" class="text-xs font-bold text-primary border border-orange-200 bg-orange-50 hover:bg-orange-100 px-4 py-2 rounded-lg transition">Kunjungi</button>
                </div>`;
            });
            container.innerHTML = html;
        }
        lucide.createIcons();
    }, 400);
}

async function openRatingModal(sId, sName, orderId = '') {
    if (authState.status !== 'AUTHENTICATED') {
        intentAfterLogin = 'view-cart';
        switchView('view-account');
        return showToast('Silakan login terlebih dahulu untuk menilai toko.', true);
    }
    let eligible = getRecentOutboundOrders().find(o => String(o.seller_id) === String(sId) && !hasRatedOutboundOrder(o.order_id));
    if (!eligible) {
        try {
            const orders = await fetchAPI('getMyOrders', { session_token: authState.sessionToken });
            eligible = (orders || []).find(o => String(o.seller_id) === String(sId) && String(o.status || '').toUpperCase() === 'CONTACTED' && !hasRatedOutboundOrder(o.order_id));
        } catch (e) {}
    }
    if (!eligible) return showToast('Penilaian tersedia setelah Anda mengirim pesanan melalui WhatsApp.', true);

    activeRatingSeller = sId;
    activeRatingStars = 0;
    window.__activeRatingOrderId = orderId || eligible.order_id;
    document.getElementById('rating-seller-name').textContent = sName;
    document.getElementById('rating-review').value = '';

    const modal = document.getElementById('rating-modal');
    const content = document.getElementById('rating-modal-content');
    modal.classList.remove('hidden', 'pointer-events-none');
    setRatingStar(0);
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('translate-y-full', 'scale-95');
    }, 10);
}

function closeRatingModal() {
    const modal = document.getElementById('rating-modal');
    const content = document.getElementById('rating-modal-content');
    modal.classList.add('opacity-0');
    content.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

function setRatingStar(num) {
    activeRatingStars = num;
    let html = '';
    for (let i = 1; i <= 5; i++) {
        const isFill = i <= activeRatingStars;
        html += `<i data-action="setStar" data-payload="${i}" data-lucide="star" class="w-8 h-8 md:w-10 md:h-10 cursor-pointer transition-transform active:scale-90 ${isFill ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}"></i>`;
    }
    document.getElementById('star-container').innerHTML = html;
    lucide.createIcons();
    document.getElementById('btn-submit-rating').disabled = (num === 0);
}

async function submitSellerRating() {
    if (activeRatingStars === 0 || !activeRatingSeller || authState.status !== 'AUTHENTICATED') return;
    const btn = document.getElementById('btn-submit-rating');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto text-white"></i>`;
    btn.disabled = true;
    lucide.createIcons();

    try {
        await fetchAPI('submitRating', {
            session_token: authState.sessionToken,
            seller_id: activeRatingSeller,
            order_id: window.__activeRatingOrderId || '',
            stars: activeRatingStars,
            review: document.getElementById('rating-review').value.trim()
        });
        const refreshed = await fetchAPI('getRatingSummary', { seller_id: activeRatingSeller });
        if (window.__activeRatingOrderId) markOutboundOrderRated(window.__activeRatingOrderId);
        document.querySelectorAll(`[data-rating-seller="${CSS.escape(String(activeRatingSeller))}"]`).forEach(el => {
            const score = el.querySelector('span.font-bold');
            if (score) score.textContent = refreshed.count ? Number(refreshed.average).toFixed(1) : '0.0';
            const count = el.querySelector('span.text-gray-400');
            if (count) count.textContent = el.closest('#product-detail-content') ? `(${Number(refreshed.count || 0)})` : `(${Number(refreshed.count || 0)} penilaian)`;
        });
        closeRatingModal();
        await renderOrderList();
        showToast("Terima kasih! Penilaian berhasil disimpan.");
    } catch (err) {
        showToast(err.message, true);
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function loadFlashSaleBatches() {
    try {
        flashSaleBatches = await fetchAPI('getFlashSaleBatches') || [];
        if (typeof renderProducts === 'function') renderProducts(true);
        return flashSaleBatches;
    } catch (e) {
        flashSaleBatches = [];
        return [];
    }
}

function closeFlashSaleModal() {
    const modal = document.getElementById('modal-flash-sale');
    const content = document.getElementById('modal-flash-sale-content');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

async function openFlashSaleModal(productId) {
    const p = liveProducts.find(x => x.product_id === productId);
    if (!p) return showToast('Produk tidak ditemukan.', true);
    if (authState.status !== 'AUTHENTICATED' || !(authState.sessionToken || getStoredToken())) return showToast('Silakan login sebagai seller terlebih dahulu.', true);
    authState.sessionToken = authState.sessionToken || getStoredToken();
    try {
        flashSaleSellerOptions = await fetchAPI('getFlashSaleSellerOptions', { session_token: authState.sessionToken, product_id: productId }) || [];
    } catch (e) {
        flashSaleSellerOptions = [];
        showToast(e.message || 'Gagal memuat batch Kejar Diskon.', true);
    }
    let entitlements = [];
    try {
        entitlements = await fetchAPI('getSellerEntitlements', { session_token: authState.sessionToken }) || [];
    } catch (e) {
        console.warn('[Entitlements]', e?.message || e);
    }
    const flashTokens = entitlements.filter(x => String(x.service_type || '').toUpperCase() === 'FLASH_SALE' && String(x.status || '').toUpperCase() === 'ACTIVE').reduce((n, x) => n + Number(x.remaining_tokens || 0), 0);
    document.getElementById('flash-product-id').value = p.product_id;
    document.getElementById('flash-product-name').textContent = p.product_name;
    document.getElementById('flash-normal-price').textContent = formatRupiah(p.price);
    document.getElementById('flash-normal-stock').textContent = Number(p.stock || 0);

    const tokenBox = document.getElementById('flash-token-summary');
    if (tokenBox) {
        tokenBox.innerHTML = `<div class="border rounded-lg bg-orange-50 p-3 flex items-center justify-between gap-3"><div><div class="font-bold text-sm text-gray-800">Token Kejar Diskon</div><div class="text-xs text-gray-600 mt-1">Tersedia <b>${flashTokens}</b> token · 1 token digunakan untuk 1 batch</div></div><button type="button" data-action="openFlashTokenPurchase" class="bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg">${flashTokens > 0 ? 'Tambah Token' : 'Beli Paket'}</button></div>`;
    }
    const list = document.getElementById('flash-batch-list');
    if (!list) return;
    if (!flashSaleSellerOptions.length) {
        list.innerHTML = '<div class="border rounded-lg p-4 text-sm text-gray-500 text-center">Belum ada batch Kejar Diskon yang dibuat admin atau seluruh batch sudah berjalan/terlewat.</div>';
        document.getElementById('btn-submit-flash-sale').disabled = true;
    } else {
        const joinable = flashSaleSellerOptions.some(b => b.can_join) && flashTokens > 0;
        document.getElementById('btn-submit-flash-sale').disabled = !joinable;
        list.innerHTML = flashSaleSellerOptions.map(b => {
            const submitted = !!b.already_submitted, disabled = submitted || !b.can_join || flashTokens <= 0, label = submitted ? 'Sudah diajukan' : (!b.can_join ? 'Tidak tersedia' : 'Tersedia');
            const submittedAt = submitted && b.submitted_at ? `<div class="text-[10px] text-amber-700 mt-1">Sudah diajukan pada ${new Date(b.submitted_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium', hour12: false })} · Status ${escapeHTML(b.existing_submission_status || 'PENDING')}</div>` : '';
            const reason = submitted ? 'Pengajuan batch ini sudah pernah dibuat oleh seller.' : (!b.can_join && Number(b.remaining_quota || 0) <= 0 ? 'Quota batch penuh.' : (!b.can_join ? 'Batch tidak dapat diikuti.' : ''));
            return `<div class="border rounded-lg p-3 ${disabled ? 'bg-gray-50' : ''}"><label class="flex items-start gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}"><input type="checkbox" class="flash-batch-check mt-1 w-4 h-4 text-primary" value="${escapeHTML(b.batch_id)}" ${disabled ? 'disabled' : ''}><span class="flex-1"><span class="flex items-center justify-between gap-2"><span class="font-bold text-sm text-gray-800">${escapeHTML(b.name)}</span><span class="text-[10px] font-bold ${submitted ? 'text-amber-700' : (disabled ? 'text-gray-500' : 'text-green-700')}">${label}</span></span><span class="block text-[10px] text-gray-500 mt-1">${new Date(b.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })} - ${new Date(b.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })} · Quota ${b.quota} · Tersisa ${Number(b.remaining_quota || 0)}</span>${submittedAt}${reason ? `<div class="text-[10px] text-red-500 mt-1">${escapeHTML(reason)}</div>` : ''}</span></label><div class="grid grid-cols-2 gap-2 mt-3"><div><label class="block text-[10px] font-bold text-gray-500 mb-1">Harga Promo</label><input type="number" min="1" class="flash-batch-price w-full border rounded-md px-3 py-2 text-sm ${disabled ? 'bg-gray-100' : ''}" data-batch-id="${escapeHTML(b.batch_id)}" placeholder="Kosong = harga normal" ${disabled ? 'disabled' : ''}></div><div><label class="block text-[10px] font-bold text-gray-500 mb-1">Stok Promo</label><input type="number" min="1" class="flash-batch-stock w-full border rounded-md px-3 py-2 text-sm ${disabled ? 'bg-gray-100' : ''}" data-batch-id="${escapeHTML(b.batch_id)}" placeholder="Kosong = stok normal" ${disabled ? 'disabled' : ''}></div></div></div>`;
        }).join('');
    }
    const m = document.getElementById('modal-flash-sale');
    const box = m?.querySelector(':scope > div');
    if (m && box) {
        m.classList.remove('hidden', 'pointer-events-none');
        setTimeout(() => { m.classList.remove('opacity-0'); box.classList.remove('translate-y-full', 'scale-95'); }, 10);
        lucide.createIcons();
    }
}

async function submitFlashSaleForm(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-flash-sale');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Mengirim...';
    try {
        const requests = Array.from(document.querySelectorAll('.flash-batch-check:checked:not(:disabled)')).map(chk => {
            const id = chk.value;
            const price = document.querySelector(`.flash-batch-price[data-batch-id="${CSS.escape(id)}"]`)?.value || '';
            const stock = document.querySelector(`.flash-batch-stock[data-batch-id="${CSS.escape(id)}"]`)?.value || '';
            return { batch_id: id, promo_price: price, promo_stock: stock };
        });
        if (!requests.length) throw new Error('Pilih minimal 1 batch.');
        let ents = [];
        try { ents = await fetchAPI('getSellerEntitlements', { session_token: authState.sessionToken }) || []; } catch (e) { }
        const tokenCount = ents.filter(x => String(x.service_type || '').toUpperCase() === 'FLASH_SALE' && String(x.status || '').toUpperCase() === 'ACTIVE').reduce((n, x) => n + Number(x.remaining_tokens || 0), 0);
        if (tokenCount < requests.length) {
            closeFlashSaleModal();
            return openFlashTokenPurchase(requests.length, tokenCount);
        }
        await fetchAPI('submitFlashSaleApplication', {
            session_token: authState.sessionToken,
            product_id: document.getElementById('flash-product-id').value,
            batch_requests: requests
        });
        closeFlashSaleModal();
        await loadCatalog();
        renderSellerDashboard();
        showToast('Pengajuan Kejar Diskon dikirim ke admin.');
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = old;
    }
}

async function openFlashTokenPurchase(required = 1, available = 0) {
    try {
        switchView('view-flash-token-purchase');
        const box = document.getElementById('flash-token-purchase-page-content');
        if (!box) return;
        box.innerHTML = '<div class="py-8 text-center text-sm text-gray-400">Memuat paket...</div>';
        const packs = await fetchAPI('getServicePackages', { session_token: authState.sessionToken, service_type: 'FLASH_SALE' }) || [];
        box.innerHTML = packs.length ? packs.map(p => `
            <div class="bg-white border rounded-xl p-4 flex items-center justify-between gap-3 shadow-sm">
                <div>
                    <div class="font-bold text-sm text-gray-800">${escapeHTML(p.package_name)}</div>
                    <div class="text-xs text-gray-500 mt-1">${Number(p.token_qty)} token · ${Number(p.duration_days || 365)} hari · Rp1.000/token</div>
                    <div class="text-sm font-bold text-primary mt-2">${formatRupiah(p.price)}</div>
                    <div class="text-[10px] text-gray-400 mt-1">Non-refundable · UAT mode</div>
                </div>
                <button type="button" class="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg" onclick="startFlashTokenPayment('${escapeHTML(p.package_id)}')">Beli Paket</button>
            </div>
        `).join('') : '<div class="text-sm text-gray-500 text-center py-8">Paket token belum diaktifkan/admin belum mengisi pricing di Service_Packages.</div>';
        lucide.createIcons();
    } catch (e) {
        showToast(e.message || 'Gagal memuat paket token.', true);
    }
}

async function startFlashTokenPayment(packageId) {
    try {
        const result = await fetchAPI('createServicePayment', { session_token: authState.sessionToken, package_id: packageId });
        if (result && (result.mode === 'UAT_DUMMY' || result.uat)) {
            openUatPaymentModal(result);
            return;
        }
        const client = await fetchAPI('getPaymentClientConfig', { session_token: authState.sessionToken });
        if (!client.enabled || !client.client_key) throw new Error('Midtrans Client Key belum dikonfigurasi.');
        await loadMidtransSnap(client.client_key, client.environment);
        if (!window.snap || !result.snap_token) throw new Error('Token pembayaran Midtrans tidak diterima.');
        window.snap.pay(result.snap_token, {
            onSuccess: function () { showToast('Pembayaran diterima. Menunggu sinkronisasi otomatis.'); },
            onPending: function () { showToast('Pembayaran masih pending.'); },
            onError: function () { showToast('Pembayaran gagal.', true); },
            onClose: function () { }
        });
        document.getElementById('flash-token-purchase-modal')?.remove();
    } catch (e) {
        showToast(e.message || 'Gagal memulai pembayaran.', true);
    }
}

function openUatPaymentModal(result) {
    let m = document.getElementById('uat-payment-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'uat-payment-modal';
        m.className = 'fixed inset-0 z-[160] bg-black/60 flex items-center justify-center p-4';
        document.body.appendChild(m);
    }
    m.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <div class="flex items-center justify-between mb-3">
                <div>
                    <h3 class="font-bold text-lg">Simulasi Pembayaran UAT</h3>
                    <p class="text-xs text-gray-500 mt-1">Gateway Midtrans sementara NONAKTIF untuk UAT. Tidak ada transaksi nyata.</p>
                </div>
                <button type="button" class="text-gray-500 text-xl" onclick="document.getElementById('uat-payment-modal')?.remove()">×</button>
            </div>
            <div class="bg-orange-50 border border-orange-100 rounded-xl p-4 space-y-1 text-sm">
                <div><b>Paket:</b> ${escapeHTML(result.package?.package_name || '-')}</div>
                <div><b>Total:</b> ${formatRupiah(result.amount || 0)}</div>
                <div><b>Order:</b> ${escapeHTML(result.order_id || '-')}</div>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-4">
                <button type="button" class="border rounded-lg py-3 text-sm font-bold" onclick="simulateUatPayment('${escapeHTML(result.payment_id)}','PENDING')">Pending</button>
                <button type="button" class="bg-primary text-white rounded-lg py-3 text-sm font-bold" onclick="simulateUatPayment('${escapeHTML(result.payment_id)}','PAID')">Simulasikan PAID</button>
            </div>
            <button type="button" class="w-full mt-2 border border-red-200 text-red-600 rounded-lg py-2.5 text-sm font-bold" onclick="simulateUatPayment('${escapeHTML(result.payment_id)}','CANCEL')">Batalkan UAT</button>
        </div>`;
}

async function simulateUatPayment(paymentId, decision) {
    try {
        await fetchAPI('simulateUatPayment', { session_token: authState.sessionToken, payment_id: paymentId, decision: decision });
        document.getElementById('uat-payment-modal')?.remove();
        showToast(decision === 'PAID' ? 'UAT payment PAID. Token/entitlement sudah masuk.' : (decision === 'PENDING' ? 'UAT payment masih pending.' : 'UAT payment dibatalkan.'), decision === 'CANCEL');
        try {
            const me = await fetchAPI('authMe', { session_token: authState.sessionToken });
            authState.seller = me.seller || authState.seller;
            authState.sellerServices = me.seller_services || [];
        } catch (_) { }
        await loadCatalog();
        renderSellerDashboard();
        switchView('view-seller-dashboard');
    } catch (e) {
        showToast(e.message || 'Gagal memproses UAT payment.', true);
    }
}

function loadMidtransSnap(clientKey, environment) {
    return new Promise((resolve, reject) => {
        if (window.snap) return resolve();
        const s = document.createElement('script');
        s.src = (environment === 'production' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com') + '/snap/snap.js';
        s.setAttribute('data-client-key', clientKey);
        s.onload = resolve;
        s.onerror = () => reject(new Error('Gagal memuat Midtrans Snap.'));
        document.head.appendChild(s);
    });
}

