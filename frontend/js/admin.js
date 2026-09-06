/**
 * BLANJAAN v2.0 — Admin Dashboard & Moderation Logic
 * Dashboard metrics, Seller verification, Flash Sale batches, Services review,
 * Hero Banner CRUD, and Token Tarif Settings.
 */

function hasAdminRoleClient() {
    return !!(authState.user && Array.isArray(authState.user.roles) && authState.user.roles.map(r => String(r).toUpperCase()).includes('ADMIN'));
}

async function openAdminDashboard() {
    if (!hasAdminRoleClient()) return showToast('Akses admin diperlukan.', true);
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia. Silakan login kembali.', true);
    authState.sessionToken = token;
    switchView('view-admin-dashboard');
    await refreshAdminDashboard();
    await refreshPolicyReview();
    await loadAdminHeroBanners();
    await loadAdminTokenTarif();
    startAdminDashboardAutoRefresh();
}

async function refreshAdminDashboard(options = {}) {
    const silent = !!options.silent;
    if (!hasAdminRoleClient()) return;
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia. Silakan login kembali.', true);
    authState.sessionToken = token;
    try {
        const d = await fetchAPI('getAdminDashboard', { session_token: token });
        let adminPayments = [];
        try {
            adminPayments = await fetchAPI('getPaymentTransactions', { session_token: token }) || [];
        } catch (e) {
            console.warn('[Admin payments]', e?.message || e);
        }
        adminDashboardCache = d;
        const statsEl = document.getElementById('admin-stats');
        if (statsEl) {
            statsEl.innerHTML = [
                ['Users', d.users],
                ['Seller Aktif', d.sellers],
                ['Pending Seller', d.pending_seller_applications],
                ['Produk', d.products]
            ].map(x => `<div class="bg-white border rounded-xl p-4"><div class="text-[10px] text-gray-500">${x[0]}</div><div class="text-2xl font-bold text-primary mt-1">${x[1] || 0}</div></div>`).join('');
        }
        renderAdminSellerApplications(d.seller_applications || []);
        renderAdminSellerServices(d.seller_services_mirror || []);
        flashSaleBatches = Array.isArray(d.flash_sale_batches) ? d.flash_sale_batches : [];
        renderAdminBatches(flashSaleBatches);
        renderAdminFlashApplications(d.flash_sale_applications || []);
        renderAdminServiceApps((d.service_applications || []).map(x => {
            x.store_name = (d.seller_services_mirror || []).find(s => s.seller_id === x.seller_id)?.store_name || x.store_name;
            return x;
        }));
        renderAdminPromotionApps((d.promotion_applications || []).map(x => {
            x.store_name = (d.seller_services_mirror || []).find(s => s.seller_id === x.seller_id)?.store_name || x.store_name;
            return x;
        }));
        renderAdminPayments(adminPayments);
        return d;
    } catch (err) {
        console.error('[Admin Dashboard]', err);
        if (!silent) showToast(err.message || 'Gagal memuat dashboard admin.', true);
        throw err;
    }
}

function startAdminDashboardAutoRefresh() {
    clearInterval(adminDashboardRefreshTimer);
    adminDashboardRefreshTimer = setInterval(() => {
        const view = document.getElementById('view-admin-dashboard');
        if (!view || !view.classList.contains('active') || !hasAdminRoleClient()) return;
        refreshAdminDashboard({ silent: true }).catch(err => console.warn('[Admin auto refresh]', err?.message || err));
    }, 20000);
}

function renderAdminSellerApplications(apps) {
    const c = document.getElementById('admin-seller-apps');
    if (!c) return;
    if (!apps.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Belum ada pengajuan seller.</div>';
        return;
    }
    c.innerHTML = apps.map(a => {
        const st = String(a.status || '').toUpperCase();
        const act = st === 'PENDING' ? `
            <div class="flex gap-2">
                <button data-action="adminReviewSeller" data-payload="${escapeHTML(a.application_id)}" data-payload2="APPROVE" class="bg-green-600 text-white text-xs px-3 py-2 rounded-md font-bold">Approve</button>
                <button data-action="adminReviewSeller" data-payload="${escapeHTML(a.application_id)}" data-payload2="REJECT" class="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-md font-bold">Reject</button>
            </div>` : '';
        return `
            <div class="border rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div>
                    <div class="font-bold text-sm">${escapeHTML(a.store_name || '-')}</div>
                    <div class="text-xs text-gray-500">${escapeHTML(a.wa || '')} · ${escapeHTML(a.city || '')}</div>
                    <div class="text-[10px] mt-1 font-bold">${st}</div>
                </div>
                ${act}
            </div>`;
    }).join('');
}

function renderAdminSellerServices(rows) {
    const c = document.getElementById('admin-seller-services');
    if (!c) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Belum ada seller aktif.</div>';
        return;
    }
    const types = ['UMKM_TERPERCAYA', 'UMKM_PILIHAN', 'FLASH_SALE', 'BLANJAAN_PLAY', 'PAID_PACKAGE'];
    const head = types.map(function (t) {
        return '<th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">' + escapeHTML(serviceTypeLabel(t)) + '</th>';
    }).join('');

    const body = data.map(function (s) {
        const map = {};
        (s.services || []).forEach(function (x) { map[String(x.service_type).toUpperCase()] = x; });
        let cells = '<td class="px-3 py-3 font-bold text-xs text-primary whitespace-nowrap cursor-pointer" data-action="openAdminSellerDetail" data-payload="' + escapeHTML(s.seller_id || '') + '">' + escapeHTML(s.store_name || 'Toko') + ' <span class="text-[9px] text-gray-400">› detail</span></td>';
        types.forEach(function (t) {
            const x = map[t] || { status: 'NOT_APPLIED' };
            const active = ['ACTIVE', 'APPROVED', 'PAID'].includes(String(x.status || '').toUpperCase());
            let html = '<div class="inline-flex items-center gap-1.5 text-[10px] font-bold ' + (active ? 'text-green-700' : 'text-gray-500') + '"><span class="inline-flex w-4 h-4 rounded-full items-center justify-center ' + (active ? 'bg-green-100' : 'bg-gray-100') + '">' + (active ? '✓' : '—') + '</span>' + escapeHTML(serviceStatusLabel(x.status)) + '</div>';
            if (x.package_name) html += '<div class="text-[9px] text-gray-400 mt-1">' + escapeHTML(x.package_name) + '</div>';
            if (x.amount) html += '<div class="text-[9px] text-gray-500">' + formatRupiah(Number(x.amount || 0)) + '</div>';
            if (x.start_at || x.end_at) html += '<div class="text-[9px] text-gray-400 mt-1">' + (x.start_at ? new Date(x.start_at).toLocaleDateString('id-ID') : '') + (x.end_at ? ' - ' + new Date(x.end_at).toLocaleDateString('id-ID') : '') + '</div>';
            cells += '<td class="px-3 py-3 align-top">' + html + '</td>';
        });
        return '<tr class="border-t">' + cells + '</tr>';
    }).join('');
    c.innerHTML = '<div class="overflow-x-auto"><table class="min-w-[980px] w-full text-left border-collapse"><thead class="bg-gray-50"><tr><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide">Seller</th>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderAdminServiceApps(rows) {
    const c = document.getElementById('admin-service-apps');
    if (!c) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Belum ada pengajuan layanan.</div>';
        return;
    }
    c.innerHTML = `<table class="min-w-[900px] w-full text-left"><thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-[10px]">Seller</th><th class="px-3 py-2 text-[10px]">Program</th><th class="px-3 py-2 text-[10px]">Status</th><th class="px-3 py-2 text-[10px]">Tanggal</th><th class="px-3 py-2 text-[10px]">Aksi</th></tr></thead><tbody>${data.map(a => `<tr class="border-t"><td class="px-3 py-2 text-xs">${escapeHTML(a.store_name || a.seller_id || '-')}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(serviceTypeLabel(a.service_type))}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(serviceStatusLabel(a.status))}</td><td class="px-3 py-2 text-[10px] text-gray-500">${a.created_at ? new Date(a.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}</td><td class="px-3 py-2">${String(a.status).toUpperCase() === 'PENDING' ? `<div class="flex gap-1"><button data-action="adminApproveService" data-payload="${escapeHTML(a.application_id)}" class="bg-green-600 text-white text-[10px] px-2 py-1.5 rounded">Approve</button><button data-action="adminRejectService" data-payload="${escapeHTML(a.application_id)}" class="bg-red-50 text-red-600 text-[10px] px-2 py-1.5 rounded">Reject</button></div>` : '—'}</td></tr>`).join('')}</tbody></table>`;
}

function renderAdminPromotionApps(rows) {
    const c = document.getElementById('admin-promotion-apps');
    if (!c) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Belum ada pengajuan paket.</div>';
        return;
    }
    c.innerHTML = `<table class="min-w-[950px] w-full text-left"><thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-[10px]">Seller</th><th class="px-3 py-2 text-[10px]">Paket</th><th class="px-3 py-2 text-[10px]">Nilai</th><th class="px-3 py-2 text-[10px]">Bukti</th><th class="px-3 py-2 text-[10px]">Status</th><th class="px-3 py-2 text-[10px]">Aksi</th></tr></thead><tbody>${data.map(a => `<tr class="border-t"><td class="px-3 py-2 text-xs">${escapeHTML(a.store_name || a.seller_id || '-')}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(a.package_name || '-')}</td><td class="px-3 py-2 text-xs font-bold text-primary">${formatRupiah(a.amount || 0)}</td><td class="px-3 py-2 text-[10px]">${a.payment_proof ? `<a href="${escapeHTML(a.payment_proof)}" target="_blank" rel="noopener" class="text-primary underline">Lihat</a>` : '-'}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(serviceStatusLabel(a.status))}</td><td class="px-3 py-2">${String(a.status).toUpperCase() === 'PENDING' ? `<div class="flex gap-1"><button data-action="adminApprovePromotion" data-payload="${escapeHTML(a.application_id)}" class="bg-green-600 text-white text-[10px] px-2 py-1.5 rounded">Approve</button><button data-action="adminRejectPromotion" data-payload="${escapeHTML(a.application_id)}" class="bg-red-50 text-red-600 text-[10px] px-2 py-1.5 rounded">Reject</button></div>` : '—'}</td></tr>`).join('')}</tbody></table>`;
}

function renderAdminPayments(rows) {
    const c = document.getElementById('admin-payment-transactions');
    if (!c) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Belum ada transaksi pembayaran.</div>';
        return;
    }
    c.innerHTML = `<table class="min-w-[980px] w-full text-left"><thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-[10px]">Seller</th><th class="px-3 py-2 text-[10px]">Paket</th><th class="px-3 py-2 text-[10px]">Nilai</th><th class="px-3 py-2 text-[10px]">Order</th><th class="px-3 py-2 text-[10px]">Status</th><th class="px-3 py-2 text-[10px]">Mulai / Expired</th><th class="px-3 py-2 text-[10px]">Aksi</th></tr></thead><tbody>${data.map(a => `<tr class="border-t"><td class="px-3 py-2 text-xs font-bold">${escapeHTML(a.store_name || a.seller_id || '-')}</td><td class="px-3 py-2 text-xs">${escapeHTML(a.package_name || '-')}</td><td class="px-3 py-2 text-xs font-bold text-primary">${formatRupiah(a.amount || 0)}</td><td class="px-3 py-2 text-[10px]">${escapeHTML(a.order_id || '-')}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(a.payment_status || '-')}${a.mode === 'UAT_DUMMY' ? '<div class="text-[9px] text-orange-600">UAT DUMMY</div>' : ''}</td><td class="px-3 py-2 text-[10px] text-gray-500">${a.start_at ? new Date(a.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}<br>${a.expires_at ? new Date(a.expires_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}</td><td class="px-3 py-2">${a.mode === 'UAT_DUMMY' && a.payment_status === 'PENDING' ? `<button data-action="adminMarkUatPaid" data-payload="${escapeHTML(a.payment_id)}" class="bg-green-600 text-white text-[10px] px-2 py-1.5 rounded">Mark PAID</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
}

async function reviewAdminService(id, decision) {
    try {
        await fetchAPI('reviewServiceApplication', { session_token: authState.sessionToken, application_id: id, decision });
        await refreshAdminDashboard();
        showToast('Pengajuan layanan diproses.');
    } catch (e) {
        showToast(e.message, true);
    }
}

async function reviewAdminPromotion(id, decision) {
    try {
        await fetchAPI('reviewPromotionApplication', { session_token: authState.sessionToken, application_id: id, decision });
        await refreshAdminDashboard();
        showToast('Pengajuan paket diproses.');
    } catch (e) {
        showToast(e.message, true);
    }
}

async function openAdminSellerDetail(sellerId) {
    const m = document.getElementById('modal-admin-seller-detail');
    const b = document.getElementById('modal-admin-seller-detail-content');
    const body = document.getElementById('admin-seller-detail-body');
    if (!m || !b || !body) return;

    body.innerHTML = '<div class="py-8 text-center text-sm text-gray-400">Memuat detail seller...</div>';
    m.classList.remove('hidden', 'pointer-events-none');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        b.classList.remove('translate-y-full', 'scale-95');
    });

    try {
        const d = await fetchAPI('getAdminSellerDetail', { session_token: authState.sessionToken, seller_id: sellerId });
        document.getElementById('admin-seller-detail-title').textContent = d.seller?.name || d.seller?.store_name || 'Detail Seller';
        const svc = (d.services || []).map(x => `
            <div class="border rounded-lg p-3">
                <div class="font-bold text-xs">${escapeHTML(serviceTypeLabel(x.service_type))}</div>
                <div class="text-[10px] text-gray-500 mt-1">${escapeHTML(serviceStatusLabel(x.status))}${x.amount ? ` · ${formatRupiah(x.amount)}` : ''}</div>
            </div>`).join('');
        const fd = (d.flash_details || []).map(x => `
            <div class="border rounded-lg p-3">
                <div class="font-bold text-xs">${escapeHTML(x.batch_name || x.batch_id)}</div>
                <div class="text-[10px] text-gray-500">${x.start_at ? new Date(x.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'} - ${x.end_at ? new Date(x.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}</div>
                <div class="text-[10px] mt-1">${escapeHTML(x.status)} · Harga ${formatRupiah(x.promo_price || 0)} · Stok ${Number(x.promo_stock || 0)}</div>
            </div>`).join('');

        body.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <div class="border rounded-xl p-3"><div class="text-[10px] text-gray-500">Program Aktif</div><div class="text-xl font-bold text-primary">${Number(d.stats?.service_programs || 0)}</div></div>
                <div class="border rounded-xl p-3"><div class="text-[10px] text-gray-500">Total Batch Promo</div><div class="text-xl font-bold text-primary">${Number(d.stats?.flash_total || 0)}</div></div>
                <div class="border rounded-xl p-3"><div class="text-[10px] text-gray-500">Batch Aktif</div><div class="text-xl font-bold text-primary">${Number(d.stats?.flash_active || 0)}</div></div>
                <div class="border rounded-xl p-3"><div class="text-[10px] text-gray-500">Status Toko</div><div class="text-sm font-bold">${escapeHTML(d.seller?.status || '-')}</div></div>
            </div>
            <div class="border rounded-xl p-4 mb-4">
                <div class="font-bold text-sm mb-3">Program / Layanan</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">${svc || '<div class="text-xs text-gray-400">Belum ada.</div>'}</div>
            </div>
            <div class="border rounded-xl p-4">
                <div class="font-bold text-sm mb-3">Seluruh Batch Kejar Diskon</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">${fd || '<div class="text-xs text-gray-400">Belum ada batch.</div>'}</div>
            </div>
            <div class="border rounded-xl p-4 mt-4">
                <div class="font-bold text-sm mb-3">Riwayat Pengajuan Layanan</div>
                <div class="space-y-2">${(d.service_applications || []).map(a => `<div class="border rounded-lg p-2.5"><div class="font-bold text-xs">${escapeHTML(serviceTypeLabel(a.service_type))}</div><div class="text-[10px] text-gray-500">${escapeHTML(serviceStatusLabel(a.status))} · ${a.created_at ? new Date(a.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}</div>${a.notes ? `<div class="text-[10px] text-gray-400 mt-1">${escapeHTML(a.notes)}</div>` : ''}</div>`).join('') || '<div class="text-xs text-gray-400">Belum ada.</div>'}</div>
            </div>
            <div class="border rounded-xl p-4 mt-4">
                <div class="font-bold text-sm mb-3">Paket Berbayar</div>
                <div class="space-y-2">${(d.promotion_applications || []).map(a => `<div class="border rounded-lg p-2.5"><div class="font-bold text-xs">${escapeHTML(a.package_name || 'Paket')}</div><div class="text-[10px] text-gray-500">${escapeHTML(serviceStatusLabel(a.status))} · ${formatRupiah(a.amount || 0)}</div>${a.payment_proof ? `<a class="text-[10px] text-primary underline" href="${escapeHTML(a.payment_proof)}" target="_blank" rel="noopener">Lihat bukti pembayaran</a>` : ''}</div>`).join('') || '<div class="text-xs text-gray-400">Belum ada.</div>'}</div>
            </div>`;
        lucide.createIcons();
    } catch (e) {
        body.innerHTML = `<div class="text-sm text-red-600">${escapeHTML(e.message || 'Gagal memuat detail seller.')}</div>`;
    }
}

function closeAdminSellerDetail() {
    const m = document.getElementById('modal-admin-seller-detail');
    const b = document.getElementById('modal-admin-seller-detail-content');
    if (!m || !b) return;
    m.classList.add('opacity-0');
    b.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => m.classList.add('hidden', 'pointer-events-none'), 220);
}

async function refreshPolicyReview() {
    try {
        const rows = await fetchAPI('getPolicyReviewProducts', { session_token: authState.sessionToken }) || [];
        renderAdminPolicyProducts(rows);
    } catch (e) {
        showToast(e.message || 'Gagal memuat review produk.', true);
    }
}

function renderAdminPolicyProducts(rows) {
    const c = document.getElementById('admin-policy-products');
    if (!c) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Tidak ada produk yang menunggu review policy.</div>';
        return;
    }
    c.innerHTML = `<table class="min-w-[900px] w-full text-left"><thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-[10px]">Seller</th><th class="px-3 py-2 text-[10px]">Produk</th><th class="px-3 py-2 text-[10px]">Kategori</th><th class="px-3 py-2 text-[10px]">Status</th><th class="px-3 py-2 text-[10px]">Aksi</th></tr></thead><tbody>${data.map(a => `<tr class="border-t"><td class="px-3 py-2 text-xs font-bold">${escapeHTML(a.store_name || a.seller_id || '-')}</td><td class="px-3 py-2 text-xs">${escapeHTML(a.product_name || '-')}</td><td class="px-3 py-2 text-xs">${escapeHTML(a.category || '-')}</td><td class="px-3 py-2 text-xs font-bold">${escapeHTML(a.status || '-')}</td><td class="px-3 py-2"><div class="flex gap-1"><button data-action="adminPolicyApprove" data-payload="${escapeHTML(a.product_id)}" class="bg-green-600 text-white text-[10px] px-2 py-1.5 rounded">Approve</button><button data-action="adminPolicyBlock" data-payload="${escapeHTML(a.product_id)}" class="bg-red-50 text-red-600 text-[10px] px-2 py-1.5 rounded">Block</button></div></td></tr>`).join('')}</tbody></table>`;
}

async function reviewProductPolicyClient(id, decision) {
    try {
        await fetchAPI('reviewProductPolicy', { session_token: authState.sessionToken, product_id: id, decision });
        showToast(decision === 'APPROVE' ? 'Produk diaktifkan.' : 'Produk diblokir.');
        await refreshPolicyReview();
        await loadCatalog();
    } catch (e) {
        showToast(e.message || 'Gagal memproses policy.', true);
    }
}

function renderAdminBatches(bs) {
    const c = document.getElementById('admin-batches');
    if (!c) return;
    const rows = Array.isArray(bs) ? bs : [];
    c.classList.add('max-h-80', 'overflow-y-auto');
    c.innerHTML = rows.length ? rows.map(b => `
        <div class="border rounded-lg p-3 flex justify-between gap-3">
            <div class="min-w-0">
                <div class="font-bold text-sm">${escapeHTML(b.name)}</div>
                <div class="text-xs text-gray-500">${new Date(b.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })} - ${new Date(b.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })}</div>
            </div>
            <div class="flex items-center gap-2">
                <div class="text-xs font-bold text-primary whitespace-nowrap">Quota ${b.quota}</div>
                <button data-action="adminEditBatch" data-payload="${escapeHTML(b.batch_id)}" class="p-1.5 bg-blue-50 text-blue-600 rounded-md" title="Edit"><i data-lucide="edit-3" class="w-4 h-4 pointer-events-none"></i></button>
                <button data-action="adminDeleteBatch" data-payload="${escapeHTML(b.batch_id)}" class="p-1.5 bg-red-50 text-red-600 rounded-md" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>
            </div>
        </div>`).join('') : '<div class="text-sm text-gray-400">Belum ada batch.</div>';
    lucide.createIcons();
}

let adminFlashApplicationsCache = [];
function renderAdminFlashApplications(apps) {
    adminFlashApplicationsCache = Array.isArray(apps) ? apps : [];
    const c = document.getElementById('admin-flash-apps');
    if (!c) return;
    const q = (document.getElementById('admin-flash-filter-q')?.value || '').trim().toLowerCase();
    const fs = (document.getElementById('admin-flash-filter-status')?.value || 'ALL').toUpperCase();
    const fp = (document.getElementById('admin-flash-filter-payment')?.value || 'ALL').toUpperCase();
    const fb = (document.getElementById('admin-flash-filter-batch')?.value || 'ALL');
    const batchSel = document.getElementById('admin-flash-filter-batch');
    if (batchSel) {
        const seen = new Set(Array.from(batchSel.options).map(o => o.value));
        (adminFlashApplicationsCache || []).forEach(r => (r.assigned_batches && r.assigned_batches.length ? r.assigned_batches : r.requested_batches || []).forEach(x => {
            const id = String(x.batch_id || '');
            const nm = x.batch_name || x.requested_batch_name || id;
            if (id && !seen.has(id)) {
                const o = document.createElement('option');
                o.value = id;
                o.textContent = nm;
                batchSel.appendChild(o);
                seen.add(id);
            }
        }));
    }
    const rows = adminFlashApplicationsCache.filter(r => {
        const batchList = (r.assigned_batches && r.assigned_batches.length ? r.assigned_batches : r.requested_batches || []);
        const hay = [r.store_name, r.product?.product_name, batchList.map(x => x.requested_batch_name || x.batch_name || '').join(' ')].join(' ').toLowerCase();
        const hitBatch = fb === 'ALL' || batchList.some(x => String(x.batch_id) === String(fb));
        return (!q || hay.includes(q)) && (fs === 'ALL' || String(r.status || '').toUpperCase() === fs) && (fp === 'ALL' || String(r.payment_status || '').toUpperCase() === fp) && hitBatch;
    });

    if (!rows.length) {
        c.innerHTML = '<div class="text-sm text-gray-400 py-4 text-center">Tidak ada pengajuan yang cocok.</div>';
        return;
    }
    const head = '<thead class="bg-gray-50 sticky top-0 z-10"><tr><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Seller</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Produk</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Batch</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Jadwal</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Harga</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Stok</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Payment</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Status</th><th class="px-3 py-2 text-left text-[10px] font-bold text-gray-500">Aksi</th></tr></thead>';
    let body = [];
    rows.forEach(r => {
        const p = r.product || {}, batches = r.assigned_batches && r.assigned_batches.length ? r.assigned_batches : r.requested_batches || [], nm = r.store_name || '-';
        batches.forEach((x, idx) => {
            const status = String(r.status || '').toUpperCase();
            const act = idx === 0 && status === 'PENDING_ADMIN' ? `<div class="flex gap-1"><button data-action="adminApproveFlash" data-payload="${escapeHTML(r.request_id)}" class="bg-green-600 text-white text-[10px] px-2 py-1.5 rounded font-bold">Approve</button><button data-action="adminRejectFlash" data-payload="${escapeHTML(r.request_id)}" class="bg-red-50 text-red-600 text-[10px] px-2 py-1.5 rounded font-bold">Reject</button></div>` : '—';
            const st = x.start_at && x.end_at ? `${new Date(x.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })} - ${new Date(x.end_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : x.requested_batch_name || x.batch_name || '-';
            body.push(`<tr class="border-t"><td class="px-3 py-2 text-xs font-semibold">${escapeHTML(nm)}</td><td class="px-3 py-2 text-xs">${escapeHTML(p.product_name || '-')}<div class="text-[9px] text-gray-400">Normal ${formatRupiah(p.price || 0)} · stok ${Number(p.stock || 0)}</div></td><td class="px-3 py-2 text-[10px] text-gray-600">${escapeHTML(x.requested_batch_name || x.batch_name || x.batch_id || '-')}</td><td class="px-3 py-2 text-[10px] text-gray-600">${st}</td><td class="px-3 py-2 text-xs font-bold text-primary">${formatRupiah(x.promo_price || p.price || 0)}</td><td class="px-3 py-2 text-xs">${Number(x.promo_stock || p.stock || 0)}</td><td class="px-3 py-2 text-[10px] font-semibold">${escapeHTML(r.payment_status || 'PENDING')}</td><td class="px-3 py-2 text-[10px] font-bold">${escapeHTML(status)}</td><td class="px-3 py-2">${act}</td></tr>`);
        });
    });
    c.innerHTML = `<div class="overflow-auto max-h-[28rem]"><table class="min-w-[1100px] w-full text-left border-collapse">${head}<tbody>${body.join('')}</tbody></table></div>`;
    lucide.createIcons();
}

let adminBatchModalMode = 'edit';
let adminBatchModalId = '';
function toDateTimeLocalValue(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openAdminBatchModal(batchId, mode = 'edit') {
    const b = (flashSaleBatches || []).find(x => String(x.batch_id) === String(batchId));
    if (!b) {
        loadFlashSaleBatches().then(() => {
            const fresh = (flashSaleBatches || []).find(x => String(x.batch_id) === String(batchId));
            if (fresh) openAdminBatchModal(batchId, mode);
            else showToast('Batch sudah tidak ada atau sudah dibersihkan.', true);
        }).catch(() => showToast('Batch tidak ditemukan.', true));
        return;
    }
    adminBatchModalMode = mode;
    adminBatchModalId = String(batchId);
    const m = document.getElementById('modal-admin-batch');
    const box = m.querySelector(':scope > div');
    document.getElementById('admin-batch-modal-id').value = String(batchId);
    document.getElementById('admin-batch-modal-title').textContent = mode === 'delete' ? 'Hapus Batch Kejar Diskon' : 'Edit Batch Kejar Diskon';
    document.getElementById('admin-batch-modal-subtitle').textContent = mode === 'delete' ? 'Konfirmasi penghapusan batch yang dipilih.' : 'Perbarui jadwal dan quota batch.';
    document.getElementById('admin-batch-edit-fields').classList.toggle('hidden', mode === 'delete');
    document.getElementById('admin-batch-delete-fields').classList.toggle('hidden', mode !== 'delete');
    document.getElementById('admin-batch-delete-text').textContent = `${b.name} · ${new Date(b.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })} - ${new Date(b.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })}`;
    document.getElementById('admin-batch-modal-name').value = b.name || '';
    document.getElementById('admin-batch-modal-start').value = toDateTimeLocalValue(b.start_at);
    document.getElementById('admin-batch-modal-end').value = toDateTimeLocalValue(b.end_at);
    document.getElementById('admin-batch-modal-quota').value = Number(b.quota || 1);
    const submit = document.getElementById('btn-admin-batch-modal-submit');
    submit.textContent = mode === 'delete' ? 'Ya, Hapus Batch' : 'Simpan Perubahan';
    submit.className = mode === 'delete' ? 'flex-1 bg-red-600 hover:bg-red-700 text-white rounded-md py-2.5 text-sm font-bold' : 'flex-1 bg-primary hover:bg-primaryDark text-white rounded-md py-2.5 text-sm font-bold';
    m.classList.remove('hidden', 'pointer-events-none');
    requestAnimationFrame(() => {
        m.classList.remove('opacity-0');
        box.classList.remove('translate-y-full', 'scale-95');
    });
    lucide.createIcons();
}

function closeAdminBatchModal() {
    const m = document.getElementById('modal-admin-batch');
    if (!m) return;
    const box = m.querySelector(':scope > div');
    m.classList.add('opacity-0');
    box.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => m.classList.add('hidden', 'pointer-events-none'), 220);
}

async function submitAdminBatchModal(e) {
    e.preventDefault();
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia. Silakan login kembali.', true);
    const batchId = adminBatchModalId;
    if (!batchId) return showToast('Batch tidak valid.', true);
    const btn = document.getElementById('btn-admin-batch-modal-submit');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Memproses...';
    try {
        if (adminBatchModalMode === 'delete') {
            await fetchAPI('deleteFlashSaleBatch', { session_token: token, batch_id: batchId });
            flashSaleBatches = (flashSaleBatches || []).filter(x => String(x.batch_id) !== batchId);
            renderAdminBatches(flashSaleBatches);
            closeAdminBatchModal();
            await refreshAdminDashboard();
            showToast('Batch dihapus.');
        } else {
            const name = document.getElementById('admin-batch-modal-name').value.trim();
            const start = document.getElementById('admin-batch-modal-start').value;
            const end = document.getElementById('admin-batch-modal-end').value;
            const quota = Number(document.getElementById('admin-batch-modal-quota').value);
            const updated = await fetchAPI('updateFlashSaleBatch', { session_token: token, batch_id: batchId, name, start_at: start, end_at: end, quota });
            flashSaleBatches = (flashSaleBatches || []).map(x => String(x.batch_id) === batchId ? updated : x);
            renderAdminBatches(flashSaleBatches);
            closeAdminBatchModal();
            await refreshAdminDashboard();
            showToast('Batch diperbarui.');
        }
    } catch (err) {
        if (adminBatchModalMode === 'delete' && /Batch tidak ditemukan/i.test(err.message || '')) {
            await loadFlashSaleBatches();
            closeAdminBatchModal();
            showToast('Batch sudah tidak ada atau sudah dibersihkan.');
        } else {
            showToast(err.message || 'Operasi batch gagal.', true);
        }
    } finally {
        btn.disabled = false;
        btn.textContent = old;
    }
}

async function adminReviewSeller(id, decision) {
    try {
        await fetchAPI('reviewSellerApplication', { session_token: authState.sessionToken, application_id: id, decision });
        showToast(decision === 'APPROVE' ? 'Seller disetujui.' : 'Pengajuan seller ditolak.');
        await refreshAdminDashboard();
    } catch (err) {
        showToast(err.message, true);
    }
}

async function createAdminBatch(e) {
    e.preventDefault();
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia. Silakan login kembali.', true);
    try {
        const created = await fetchAPI('createFlashSaleBatch', {
            session_token: token,
            name: document.getElementById('admin-batch-name').value,
            start_at: document.getElementById('admin-batch-start').value,
            end_at: document.getElementById('admin-batch-end').value,
            quota: document.getElementById('admin-batch-quota').value
        });
        e.target.reset();
        document.getElementById('admin-batch-quota').value = 10;
        if (created && created.batch_id) {
            flashSaleBatches = [...(Array.isArray(flashSaleBatches) ? flashSaleBatches : []), created]
                .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
            renderAdminBatches(flashSaleBatches);
        }
        await loadFlashSaleBatches();
        showToast('Batch dibuat.');
    } catch (err) {
        showToast(err.message || 'Gagal membuat batch.', true);
    }
}

async function adminApproveFlash(requestId) {
    try {
        await fetchAPI('reviewFlashSaleApplication', { session_token: authState.sessionToken, request_id: requestId, decision: 'APPROVE', payment_status: 'PAID' });
        await refreshAdminDashboard();
        await loadCatalog();
        showToast('Kejar Diskon disetujui.');
    } catch (err) {
        showToast(err.message, true);
    }
}

async function adminRejectFlash(requestId) {
    try {
        await fetchAPI('reviewFlashSaleApplication', { session_token: authState.sessionToken, request_id: requestId, decision: 'REJECT', reason: 'Ditolak admin' });
        await refreshAdminDashboard();
        await loadCatalog();
        showToast('Pengajuan Kejar Diskon ditolak.');
    } catch (err) {
        showToast(err.message, true);
    }
}

async function adminMarkUatPaid(paymentId) {
    try {
        await fetchAPI('adminMarkUatPaid', { session_token: authState.sessionToken, payment_id: paymentId });
        showToast('Transaksi UAT ditandai PAID.');
        await refreshAdminDashboard();
    } catch (e) {
        showToast(e.message || 'Gagal mengubah transaksi UAT.', true);
    }
}

// -------------------------------------------------------------
// HERO BANNER CRUD (Fase 3)
// -------------------------------------------------------------
let adminHeroBanners = [];

async function loadAdminHeroBanners() {
    const c = document.getElementById('admin-hero-banners');
    if (!c) return;
    try {
        adminHeroBanners = await fetchAPI('adminGetBanners', { session_token: authState.sessionToken, all: true }) || [];
        renderAdminHeroBanners(adminHeroBanners);
    } catch (e) {
        console.warn('[Admin Banners]', e?.message || e);
        c.innerHTML = '<div class="text-xs text-red-500 py-3 text-center">Gagal memuat banner hero.</div>';
    }
}

function renderAdminHeroBanners(banners) {
    const c = document.getElementById('admin-hero-banners');
    if (!c) return;
    if (!banners.length) {
        c.innerHTML = '<div class="text-xs text-gray-400 py-4 text-center">Belum ada banner hero. Silakan tambah banner.</div>';
        return;
    }
    c.innerHTML = banners.map(b => `
        <div class="border rounded-xl p-3 flex flex-col sm:flex-row items-center gap-4 bg-white shadow-sm">
            <div class="w-full sm:w-36 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                <img src="${escapeHTML(b.image_url)}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_IMG}'">
            </div>
            <div class="flex-1 min-w-0 text-left">
                <div class="font-bold text-sm text-gray-800 truncate">${escapeHTML(b.title_html || 'Tanpa Judul')}</div>
                <div class="text-xs text-gray-500 truncate mt-0.5">${escapeHTML(b.subtitle || '-')}</div>
                <div class="flex items-center gap-2 mt-2">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${b.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${b.active ? 'Aktif' : 'Nonaktif'}</span>
                    <span class="text-[10px] text-gray-400">Urutan: ${b.sort_order || 0}</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" data-action="adminEditBanner" data-payload="${escapeHTML(b.banner_id)}" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-xs font-bold" title="Edit"><i data-lucide="edit-3" class="w-4 h-4 pointer-events-none"></i></button>
                <button type="button" data-action="adminDeleteBanner" data-payload="${escapeHTML(b.banner_id)}" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-xs font-bold" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function openAdminBannerModal(bannerId = null) {
    const modal = document.getElementById('modal-admin-banner');
    if (!modal) return;
    const form = document.getElementById('form-admin-banner');
    form.reset();

    if (bannerId) {
        const b = adminHeroBanners.find(x => x.banner_id === bannerId);
        if (b) {
            document.getElementById('admin-banner-id').value = b.banner_id;
            document.getElementById('admin-banner-title').value = b.title_html || '';
            document.getElementById('admin-banner-subtitle').value = b.subtitle || '';
            document.getElementById('admin-banner-image').value = b.image_url || '';
            document.getElementById('admin-banner-order').value = b.sort_order || 0;
            document.getElementById('admin-banner-active').checked = !!b.active;
            document.getElementById('admin-banner-modal-title').textContent = 'Edit Hero Banner';
        }
    } else {
        document.getElementById('admin-banner-id').value = '';
        document.getElementById('admin-banner-order').value = (adminHeroBanners.length + 1) * 10;
        document.getElementById('admin-banner-active').checked = true;
        document.getElementById('admin-banner-modal-title').textContent = 'Tambah Hero Banner';
    }

    modal.classList.remove('hidden', 'pointer-events-none');
    requestAnimationFrame(() => modal.classList.remove('opacity-0'));
}

function closeAdminBannerModal() {
    const modal = document.getElementById('modal-admin-banner');
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden', 'pointer-events-none'), 220);
}

async function saveAdminBanner(e) {
    e.preventDefault();
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia.', true);

    const bannerId = document.getElementById('admin-banner-id').value;
    const title = document.getElementById('admin-banner-title').value.trim();
    const subtitle = document.getElementById('admin-banner-subtitle').value.trim();
    const imageUrl = document.getElementById('admin-banner-image').value.trim();
    const sortOrder = Number(document.getElementById('admin-banner-order').value || 0);
    const active = document.getElementById('admin-banner-active').checked;

    if (!imageUrl) return showToast('URL gambar banner wajib diisi.', true);

    const btn = document.getElementById('btn-save-admin-banner');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
        if (bannerId) {
            await fetchAPI('updateBanner', {
                session_token: token,
                banner_id: bannerId,
                title_html: title,
                subtitle: subtitle,
                image_url: imageUrl,
                sort_order: sortOrder,
                active: active
            });
            showToast('Hero banner diperbarui.');
        } else {
            await fetchAPI('createBanner', {
                session_token: token,
                title_html: title,
                subtitle: subtitle,
                image_url: imageUrl,
                sort_order: sortOrder,
                active: active
            });
            showToast('Hero banner ditambahkan.');
        }
        closeAdminBannerModal();
        await loadAdminHeroBanners();
        if (typeof loadHeroBanners === 'function') await loadHeroBanners();
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan banner.', true);
    } finally {
        btn.disabled = false;
        btn.textContent = oldText;
    }
}

async function deleteAdminBanner(bannerId) {
    if (!confirm('Apakah Anda yakin ingin menghapus banner ini?')) return;
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia.', true);

    try {
        await fetchAPI('deleteBanner', { session_token: token, banner_id: bannerId });
        showToast('Banner dihapus.');
        await loadAdminHeroBanners();
        if (typeof loadHeroBanners === 'function') await loadHeroBanners();
    } catch (err) {
        showToast(err.message || 'Gagal menghapus banner.', true);
    }
}

// -------------------------------------------------------------
// TOKEN TARIF SETTINGS (Fase 3)
// -------------------------------------------------------------
async function loadAdminTokenTarif() {
    const form = document.getElementById('form-admin-token-tarif');
    if (!form) return;
    try {
        const tarif = await fetchAPI('getTokenTarif', { session_token: authState.sessionToken });
        if (tarif) {
            document.getElementById('tarif-blanjaan-play').value = tarif.TOKEN_COST_BLANJAAN_PLAY || 1;
            document.getElementById('tarif-umkm-pilihan').value = tarif.TOKEN_COST_UMKM_PILIHAN || 2;
            document.getElementById('tarif-iklan-banner').value = tarif.TOKEN_COST_IKLAN_BANNER || 3;
        }
    } catch (e) {
        console.warn('[Token Tarif]', e?.message || e);
    }
}

async function saveAdminTokenTarif(e) {
    e.preventDefault();
    const token = authState.sessionToken || getStoredToken();
    if (!token) return showToast('Sesi admin tidak tersedia.', true);

    const playCost = Number(document.getElementById('tarif-blanjaan-play').value || 1);
    const umkmCost = Number(document.getElementById('tarif-umkm-pilihan').value || 2);
    const bannerCost = Number(document.getElementById('tarif-iklan-banner').value || 3);

    const btn = document.getElementById('btn-save-token-tarif');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    try {
        await fetchAPI('setTokenTarif', {
            session_token: token,
            TOKEN_COST_BLANJAAN_PLAY: playCost,
            TOKEN_COST_UMKM_PILIHAN: umkmCost,
            TOKEN_COST_IKLAN_BANNER: bannerCost
        });
        showToast('Tarif token berhasil disimpan.');
    } catch (err) {
        showToast(err.message || 'Gagal menyimpan tarif token.', true);
    } finally {
        btn.disabled = false;
        btn.textContent = oldText;
    }
}
