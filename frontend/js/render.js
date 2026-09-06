/**
 * BLANJAAN v2.0 — Rendering Logic
 * Catalog, products, categories, video promo, hero banners, seller pages & dashboard
 */

let currentSelectedVariant = null;

function getActiveFlashWindow(prod, ts = Date.now()) {
    const windows = Array.isArray(prod?.flash_sale_windows) ? prod.flash_sale_windows : [];
    return windows.find(w => ts >= new Date(w.start_at).getTime() && ts < new Date(w.end_at).getTime()) || null;
}

function getNextFlashWindow(prod, ts = Date.now()) {
    const windows = Array.isArray(prod?.flash_sale_windows) ? prod.flash_sale_windows : [];
    return windows.filter(w => new Date(w.start_at).getTime() > ts).sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0] || null;
}

function isProductInActiveFlashSale(prod, ts) {
    return !!getActiveFlashWindow(prod, ts);
}

function getFlashSaleDisplayState(prod, ts = Date.now()) {
    const active = getActiveFlashWindow(prod, ts);
    if (active) return { state: 'ACTIVE', window: active };
    const next = getNextFlashWindow(prod, ts);
    if (next) return { state: 'UPCOMING', window: next };
    const past = (Array.isArray(prod?.flash_sale_windows) ? prod.flash_sale_windows : [])
        .filter(w => new Date(w.end_at).getTime() <= ts)
        .sort((a, b) => new Date(b.end_at) - new Date(a.end_at))[0] || null;
    return { state: past ? 'ENDED' : 'NONE', window: null, lastWindow: past };
}

function getEffectiveStock(prod) {
    const w = getActiveFlashWindow(prod);
    return w && Number(w.promo_stock) > 0 ? Math.min(Number(prod.stock || 0), Number(w.promo_stock)) : Number(prod.stock || 0);
}

function getFinalPrice(prod) {
    const w = getActiveFlashWindow(prod);
    if (w && Number(w.promo_price) > 0 && Number(w.promo_price) < Number(prod.price)) return Number(w.promo_price);
    return (prod.promo_price > 0 && prod.promo_price < prod.price) ? prod.promo_price : prod.price;
}

function formatCountdownMs(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderProdSkeleton(count, isFeatured = false) {
    let html = '';
    for (let i = 0; i < count; i++) {
        const inner = `<div class="bg-white rounded-md shadow-sm border border-gray-100 overflow-hidden"><div class="pb-[100%] skeleton relative"></div><div class="p-2"><div class="h-4 skeleton w-full mb-1"></div><div class="h-4 skeleton w-2/3 mb-2"></div><div class="h-5 skeleton w-1/2 mb-2"></div><div class="h-3 skeleton w-1/3"></div></div></div>`;
        html += isFeatured ? `<div class="min-w-[140px] md:min-w-[180px]">${inner}</div>` : inner;
    }
    return html;
}

function renderCatSkeleton() {
    return Array(6).fill(`<div class="flex flex-col items-center gap-1 min-w-[60px] md:min-w-[80px]"><div class="w-12 h-12 md:w-16 md:h-16 rounded-xl skeleton shadow-sm"></div><div class="w-10 md:w-14 h-3 skeleton mt-1"></div></div>`).join('');
}

function createProductCard(prod) {
    const flashState = getFlashSaleDisplayState(prod);
    const activeFlash = flashState.state === 'ACTIVE';
    const upcomingFlash = flashState.state === 'UPCOMING';
    const finalPrice = getFinalPrice(prod);
    const hasPromo = finalPrice < prod.price;
    const origPrice = hasPromo
        ? `<span class="text-[10px] md:text-xs text-gray-400 line-through block">${formatRupiah(prod.price)}</span>`
        : `<span class="text-[10px] md:text-xs opacity-0 block select-none pointer-events-none">-</span>`;
    const stockInfo = getStockInfo(getEffectiveStock(prod));
    const opacityClass = stockInfo.isAvailable ? '' : 'opacity-50 grayscale';
    const locationText = sellerCache[prod.seller_id] ? sellerCache[prod.seller_id].location : "Memuat...";
    const flashLabel = activeFlash ? 'KEJAR DISKON' : upcomingFlash ? 'PROMO BERIKUTNYA' : (flashState.state === 'ENDED' ? 'KEJAR DISKON SELESAI' : '');
    const badge = flashLabel
        ? `<div class="absolute top-0 right-0 ${activeFlash ? 'bg-red-500' : 'bg-gray-600'} text-white text-[10px] font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-bl-lg z-10 shadow-sm">${flashLabel}</div>`
        : (hasPromo && stockInfo.isAvailable ? `<div class="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-bl-lg z-10 shadow-sm">PROMO</div>` : '');
    const upcomingMeta = upcomingFlash && flashState.window
        ? `<div class="mt-2 rounded-md bg-gray-50 border border-gray-100 px-2 py-1.5 text-[10px] font-bold text-gray-600 text-center">Promo mulai dalam <span data-flash-countdown="${escapeHTML(prod.product_id)}">${formatCountdownMs(new Date(flashState.window.start_at).getTime() - Date.now())}</span></div>`
        : '';
    const clickAttrs = upcomingFlash
        ? 'class="bg-white rounded-md md:rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-default transition flex flex-col h-[365px] md:h-[420px] ' + opacityClass + '"'
        : 'class="bg-white rounded-md md:rounded-lg shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md transition flex flex-col h-[365px] md:h-[420px] ' + opacityClass + '" data-action="openProduct" data-payload="' + escapeHTML(prod.product_id) + '"';

    return `<div ${clickAttrs}><div class="relative pb-[100%] bg-gray-100 flex-shrink-0"><img src="${escapeHTML(prod.main_image)}" class="absolute top-0 left-0 w-full h-full object-cover" loading="lazy" onerror="this.src='${FALLBACK_IMG}'">${badge}${upcomingFlash ? '<div class="absolute inset-0 bg-white/20 pointer-events-none"></div>' : ''}${!stockInfo.isAvailable ? '<div class="absolute inset-0 bg-black/40 flex items-center justify-center z-10"><span class="bg-gray-800 text-white text-xs md:text-sm font-bold px-3 py-1 rounded">HABIS</span></div>' : ''}</div><div class="p-2 md:p-3 flex flex-col flex-1 justify-between"><div><h4 class="text-xs md:text-sm text-gray-800 line-clamp-2 h-[32px] md:h-[40px] leading-relaxed">${escapeHTML(prod.product_name)}</h4><div class="mt-1 flex flex-col"><span class="text-primary font-bold text-sm md:text-base">${formatRupiah(finalPrice)}</span>${origPrice}</div>${upcomingMeta}</div><div class="mt-2 flex items-center justify-between text-[10px] md:text-xs text-gray-500 pt-1.5 border-t border-gray-50"><div class="flex items-center truncate max-w-[60%]"><i data-lucide="map-pin" class="w-3 h-3 mr-0.5 text-gray-400 flex-shrink-0"></i><span class="truncate">${escapeHTML(locationText)}</span></div><span class="flex-shrink-0 ml-1 font-medium ${stockInfo.isAvailable ? '' : 'text-red-500'}">${escapeHTML(stockInfo.text)}</span></div></div></div>`;
}

function renderRepurchaseSection() {
    const section = document.getElementById('repurchase-section');
    const container = document.getElementById('repurchase-container');
    if (!section || !container) return;
    if (authState.status !== "AUTHENTICATED") {
        section.classList.add('hidden');
        return;
    }
    const repurchases = liveProducts.slice(0, 4);
    if (repurchases.length > 0) {
        let html = '';
        repurchases.forEach(p => { html += `<div class="min-w-[140px] md:min-w-[180px] h-full">${createProductCard(p)}</div>`; });
        container.innerHTML = html;
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
    }
    lucide.createIcons();
}

function renderProducts(isReset = true) {
    if (isReset) {
        currentPage = 1;
        hasMoreData = true;
        isLoadingMore = false;
        let filtered = liveProducts;

        // 1. UMKM Pilihan
        let featHtml = '';
        const featureds = liveProducts.filter(p => p.featured).slice(0, 5);
        featureds.forEach(p => featHtml += `<div class="min-w-[140px] md:min-w-[180px] h-full">${createProductCard(p)}</div>`);
        const featCont = document.getElementById('featured-container');
        if (featCont) featCont.innerHTML = featHtml || `<div class="text-xs text-gray-400 py-2 w-full text-center">Belum ada pilihan.</div>`;

        // 2. Kejar Diskon
        let discountHtml = '';
        const discountCandidates = liveProducts.filter(p => {
            const st = getFlashSaleDisplayState(p);
            return st.state === 'ACTIVE' || st.state === 'UPCOMING';
        }).sort((a, b) => {
            const sa = getFlashSaleDisplayState(a), sb = getFlashSaleDisplayState(b);
            if (sa.state !== sb.state) return sa.state === 'ACTIVE' ? -1 : 1;
            return new Date(sa.window?.start_at || 0) - new Date(sb.window?.start_at || 0);
        }).slice(0, 10);

        discountCandidates.forEach(p => discountHtml += `<div class="min-w-[140px] md:min-w-[180px] h-full">${createProductCard(p)}</div>`);
        const discCont = document.getElementById('discount-container');
        if (discCont) discCont.innerHTML = discountHtml || `<div class="text-xs text-gray-400 py-2 w-full text-center">${flashSaleBatches.length ? 'Belum ada produk Kejar Diskon aktif atau terjadwal.' : 'Belum ada batch Kejar Diskon yang dijadwalkan admin.'}</div>`;

        // 3. Produk Sekitarmu
        let nearbyHtml = '';
        const nearby = liveProducts.slice().reverse().slice(0, 5);
        nearby.forEach(p => nearbyHtml += `<div class="min-w-[140px] md:min-w-[180px] h-full">${createProductCard(p)}</div>`);
        const nearCont = document.getElementById('nearby-container');
        if (nearCont) nearCont.innerHTML = nearbyHtml || `<div class="text-xs text-gray-400 py-2 w-full text-center">Belum ada penjual di sekitar.</div>`;

        // 4. Rekomendasi
        let recs = [...filtered];
        if (activeFilter === 'terbaru') recs.reverse();
        else if (activeFilter === 'terpopuler') recs.sort((a, b) => b.views - a.views);
        else if (activeFilter === 'harga') recs.sort((a, b) => sortHargaAsc ? (getFinalPrice(a) - getFinalPrice(b)) : (getFinalPrice(b) - getFinalPrice(a)));
        else if (activeFilter === 'terdekat') {
            if (authState.status === 'AUTHENTICATED' && authState.user && authState.user.city) {
                const userCity = authState.user.city.toLowerCase();
                recs = recs.filter(p => {
                    const seller = sellerCache[p.seller_id];
                    return seller && seller.location && seller.location.toLowerCase() === userCity;
                });
            } else {
                recs = [];
            }
        }

        currentFilteredProducts = recs;
        const prodCont = document.getElementById('products-container');
        if (prodCont) prodCont.innerHTML = '';
    }

    if (!hasMoreData) return;

    const container = document.getElementById('products-container');
    if (!container) return;
    const loader = document.getElementById('infinite-loader');
    if (loader) loader.remove();

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const slice = currentFilteredProducts.slice(startIndex, endIndex);

    let gridHtml = '';
    if (currentFilteredProducts.length === 0 && isReset) {
        let emptyMsg = "Produk tidak ditemukan.";
        if (activeFilter === 'terdekat') {
            if (!authState.user || !authState.user.city) {
                emptyMsg = "Silakan login dan atur Kota Anda di Menu Akun untuk melihat produk terdekat.";
            } else {
                emptyMsg = "Belum ada produk dari penjual di kota Anda (" + escapeHTML(authState.user.city) + ").";
            }
        }
        gridHtml = `<div class="col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-12"><i data-lucide="package-open" class="w-12 h-12 text-gray-300 mx-auto mb-2"></i><p class="text-gray-500 text-sm">${emptyMsg}</p></div>`;
        container.innerHTML = gridHtml;
        hasMoreData = false;
    } else {
        slice.forEach(prod => gridHtml += createProductCard(prod));
        container.insertAdjacentHTML('beforeend', gridHtml);
        if (endIndex >= currentFilteredProducts.length) {
            hasMoreData = false;
            container.insertAdjacentHTML('beforeend', `<div class="col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-6 text-[10px] md:text-xs text-gray-400 font-medium tracking-wide">-- Semua Produk Ditampilkan --</div>`);
        }
    }

    if (isReset && typeof renderRepurchaseSection === 'function') renderRepurchaseSection();
    lucide.createIcons();
}

function renderCategories() {
    const container = document.getElementById('category-container');
    if (!container) return;
    if (liveCategories.length === 0) {
        container.innerHTML = `<div class="text-xs text-gray-500 py-2">Tidak ada kategori.</div>`;
        return;
    }
    const catImages = {
        "Semua": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/semua.jpg",
        "Makanan": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/makanan-minuman.jpg",
        "Makanan & Minuman": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/makanan-minuman.jpg",
        "Fashion": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/fashion.jpg",
        "Elektronik": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/makanan-minuman.jpg",
        "Kerajinan": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/kerajinan-souvenir.jpg",
        "Kesehatan": "https://raw.githubusercontent.com/up2digi-app/up2digital-assets/main/blanjaan/kecantikan-kesehatan.jpg"
    };
    let html = `<div class="flex flex-col items-center gap-1 min-w-[60px] md:min-w-[80px] cursor-pointer hover:opacity-80 transition" data-action="filterCategory" data-payload="" data-payload2=""><div class="w-12 h-12 md:w-16 md:h-16 ${activeCategoryId === null ? 'border-2 border-primary shadow-sm' : 'bg-white border border-gray-200'} rounded-2xl flex items-center justify-center transition overflow-hidden"><img src="${catImages['Semua']}" class="w-full h-full object-cover"></div><span class="text-[11px] md:text-sm ${activeCategoryId === null ? 'text-primary font-bold' : 'text-gray-700 font-medium'} text-center mt-1 px-1 w-full truncate">Semua</span></div>`;
    liveCategories.forEach(cat => {
        const isAct = activeCategoryId === cat.id || activeCategoryName === cat.name;
        let imgSrc = catImages[cat.name] || `https://placehold.co/100x100/f3f4f6/a1a1aa?text=${encodeURIComponent(cat.name.substring(0, 3))}`;
        html += `<div class="flex flex-col items-center gap-1 min-w-[60px] md:min-w-[80px] cursor-pointer hover:opacity-80 transition" data-action="filterCategory" data-payload="${escapeHTML(cat.id)}" data-payload2="${escapeHTML(cat.name)}"><div class="w-12 h-12 md:w-16 md:h-16 ${isAct ? 'border-2 border-primary shadow-sm' : 'bg-white border border-gray-200'} rounded-2xl flex items-center justify-center transition overflow-hidden"><img src="${escapeHTML(imgSrc)}" class="w-full h-full object-cover"></div><span class="text-[11px] md:text-sm ${isAct ? 'text-primary font-bold' : 'text-gray-700 font-medium'} text-center truncate w-full px-1 mt-1">${escapeHTML(cat.name)}</span></div>`;
    });
    container.innerHTML = html;
}

function filterCategory(catId, catName) {
    if (!catId && !catName) {
        activeCategoryId = null;
        activeCategoryName = null;
        switchView('view-home');
        renderCategories();
        document.getElementById('products-container').innerHTML = renderProdSkeleton(4);
        setTimeout(() => renderProducts(), 150);
        return;
    }

    document.getElementById('category-page-title').textContent = "Kategori: " + catName;
    switchView('view-category');
    const container = document.getElementById('category-page-products-container');
    container.innerHTML = renderProdSkeleton(8);

    setTimeout(() => {
        const filtered = liveProducts.filter(p => p.category_id === catId || p.product_category === catName);
        if (filtered.length === 0) {
            container.innerHTML = `<div class="col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-20"><i data-lucide="package-open" class="w-16 h-16 mx-auto mb-4 text-gray-300"></i><p class="text-gray-500 text-sm">Belum ada produk di kategori ini.</p><button data-action="switchView" data-payload="view-home" class="mt-4 bg-primary text-white px-6 py-2 rounded-full text-xs font-bold shadow-sm">Kembali</button></div>`;
        } else {
            let html = '';
            filtered.forEach(p => html += createProductCard(p));
            container.innerHTML = html;
        }
        lucide.createIcons();
    }, 400);
}

function handleSetFilter(type) {
    if (type === 'terdekat') {
        if (authState.status !== 'AUTHENTICATED' || !authState.user || !authState.user.city) {
            showToast("Silakan login dan lengkapi kota di Profil Anda terlebih dahulu.", true);
        }
    }
    if (type === 'harga' && activeFilter === 'harga') sortHargaAsc = !sortHargaAsc;
    else activeFilter = type;

    document.querySelectorAll('.filter-btn').forEach(btn => {
        const p = btn.getAttribute('data-payload');
        const base = "filter-btn text-xs md:text-sm px-4 py-2 rounded-full border whitespace-nowrap transition shadow-sm ";
        if (p === type) btn.className = base + "active font-bold border-primary bg-primary text-white" + (p === 'harga' ? " flex items-center gap-1" : "");
        else btn.className = base + "font-medium border-gray-200 bg-white text-gray-600 hover:bg-gray-50" + (p === 'harga' ? " flex items-center gap-1" : "");
    });
    document.getElementById('products-container').innerHTML = renderProdSkeleton(4);
    setTimeout(() => renderProducts(true), 250);
}

async function loadProducts() {
    try {
        const rawData = await fetchAPI("products", { limit: 100, offset: 0 });
        liveProducts = normalizeProducts(rawData);
        renderProducts(true);
    } catch (e) {
        document.getElementById('products-container').innerHTML = `<div class="col-span-2 text-center text-sm text-gray-500 py-10">Gagal memuat produk.</div>`;
    }
}

async function loadCategories() {
    try {
        const data = await fetchAPI("categories");
        liveCategories = (data || []).map(c => ({
            id: normalizeId(c.category_id),
            name: normalizeText(c.category_name),
            status: normalizeStatus(c.status)
        })).filter(c => c.status === "ACTIVE");
        renderCategories();
    } catch (e) {
        document.getElementById('category-container').innerHTML = `<div class="text-xs text-gray-500 w-full text-center py-4">Gagal memuat kategori</div>`;
    }
}

async function loadCatalog() {
    try {
        const data = await fetchAPI("catalog", { limit: 100, offset: 0 });
        const categories = Array.isArray(data?.categories) ? data.categories : [];
        const products = Array.isArray(data?.products) ? data.products : [];
        const sellers = Array.isArray(data?.sellers) ? data.sellers : [];

        liveCategories = categories.map(c => ({
            id: normalizeId(c.category_id),
            name: normalizeText(c.category_name),
            status: normalizeStatus(c.status)
        })).filter(c => c.status === "ACTIVE");

        liveProducts = normalizeProducts(products);
        sellerCache = {};
        sellers.forEach(cacheSellerData);

        renderCategories();
        renderProducts(true);
    } catch (e) {
        document.getElementById('category-container').innerHTML = renderCatSkeleton();
        document.getElementById('products-container').innerHTML = renderProdSkeleton(4);
        throw e;
    }
}

function normalizeProducts(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(p => ({
        product_id: normalizeId(p.product_id),
        seller_id: normalizeId(p.seller_id),
        category_id: normalizeId(p.category_id),
        product_category: normalizeText(p.product_category),
        product_name: normalizeText(p.product_name),
        price: Number(p.price) || 0,
        promo_price: Number(p.promo_price) || 0,
        main_image: validateHttpsUrl(p.main_image) || p.main_image || FALLBACK_IMG,
        description: normalizeText(p.description),
        specification: normalizeText(p.specification),
        variants: Array.isArray(p.variants) ? p.variants.filter(Boolean).map(v => normalizeText(v)) : [],
        stock: p.stock,
        views: Number(p.views) || 0,
        featured: parseBoolean(p.featured),
        status: normalizeStatus(p.status),
        upload_date: p.upload_date || new Date(0).toISOString(),
        flash_sale_status: normalizeText(p.flash_sale_status).toUpperCase(),
        flash_sale_batch_id: normalizeText(p.flash_sale_batch_id),
        flash_sale_requested_start: p.flash_sale_requested_start || '',
        flash_sale_requested_end: p.flash_sale_requested_end || '',
        flash_sale_price: Number(p.flash_sale_price) || 0,
        flash_sale_payment_status: normalizeText(p.flash_sale_payment_status).toUpperCase(),
        flash_sale_windows: Array.isArray(p.flash_sale_windows) ? p.flash_sale_windows : []
    })).filter(p => p.status === 'ACTIVE');
}

function cacheSellerData(sData) {
    if (!sData) return null;
    const id = normalizeId(sData.seller_id);
    if (!id) return null;
    sellerCache[id] = {
        seller_id: id,
        name: normalizeText(sData.store_name),
        location: normalizeText(sData.city || sData.district),
        wa: normalizeWhatsAppNumber(sData.wa),
        website: validateHttpsUrl(sData.website),
        logo: sData.logo ? validateHttpsUrl(sData.logo) : null,
        banner: sData.banner ? validateHttpsUrl(sData.banner) : null,
        description: normalizeText(sData.description)
    };
    return sellerCache[id];
}

let sellerRequestCache = {};
async function getSeller(sellerId) {
    const id = normalizeId(sellerId);
    if (!id) return null;
    if (sellerCache[id]) return sellerCache[id];
    if (sellerRequestCache[id]) return sellerRequestCache[id];

    sellerRequestCache[id] = (async () => {
        try {
            const data = await fetchAPI("seller", { id });
            let sData = null;
            if (data && !Array.isArray(data)) sData = data;
            else if (Array.isArray(data) && data.length > 0) sData = data[0];
            if (sData) return cacheSellerData({ ...sData, seller_id: id });
        } catch (e) {}
        finally { delete sellerRequestCache[id]; }
        return null;
    })();

    return sellerRequestCache[id];
}

// Hero Banners (Fase 3 Dynamic Integration)
async function loadHeroBanners() {
    try {
        const banners = await fetchAPI('banners');
        if (Array.isArray(banners) && banners.length > 0) {
            renderHeroBanners(banners);
        }
    } catch (_) {}
}

function renderHeroBanners(banners) {
    const track = document.getElementById('carousel-track');
    const ind = document.getElementById('carousel-indicators');
    if (!track || !banners || !banners.length) return;

    track.innerHTML = banners.map(b => `
        <div class="min-w-full h-full relative flex-shrink-0">
            <img src="${escapeHTML(b.image_url)}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_SELLER_BANNER}'">
            <div class="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent flex flex-col justify-center px-6 md:px-12">
                <h2 class="text-white font-extrabold text-lg md:text-3xl lg:text-4xl drop-shadow-lg leading-tight mb-1">
                    ${b.title_html || ''}
                </h2>
                ${b.subtitle ? `<p class="text-white/90 text-[10px] md:text-sm max-w-[70%]">${escapeHTML(b.subtitle)}</p>` : ''}
            </div>
        </div>
    `).join('');

    if (ind) {
        ind.innerHTML = banners.map((_, i) => `<span class="w-2 h-2 rounded-full ${i === 0 ? 'bg-primary border border-white' : 'bg-white opacity-50'}"></span>`).join('');
    }
}

function initCarousel() {
    const track = document.getElementById('carousel-track');
    const dots = document.getElementById('carousel-indicators')?.children;
    if (!track || !dots || dots.length <= 1) return;
    let currentIndex = 0;
    setInterval(() => {
        currentIndex = (currentIndex + 1) % dots.length;
        track.style.transform = `translateX(-${currentIndex * 100}%)`;
        Array.from(dots).forEach((dot, i) => {
            if (i === currentIndex) {
                dot.classList.add('bg-primary', 'opacity-100');
                dot.classList.remove('bg-white', 'opacity-50');
            } else {
                dot.classList.add('bg-white', 'opacity-50');
                dot.classList.remove('bg-primary', 'opacity-100');
            }
        });
    }, 3500);
}

// Video Promo (BlanjaanPlay)
function extractYouTubeId(url) {
    const s = String(url || '');
    const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^?&/]+)/i);
    return m ? m[1] : '';
}

function normalizeVideoItem(v) {
    const url = normalizeText(v?.video_url || v?.url);
    const yt = extractYouTubeId(url);
    let thumbnail = normalizeText(v?.thumbnail_url);
    if (!thumbnail && yt) thumbnail = `https://img.youtube.com/vi/${encodeURIComponent(yt)}/hqdefault.jpg`;
    return {
        id: normalizeId(v?.video_id) || ('v' + Math.random().toString(36).slice(2)),
        url,
        title: normalizeText(v?.title),
        store: normalizeText(v?.store_name),
        thumbnail,
        platform: yt ? 'YouTube' : (/tiktok\.com/i.test(url) ? 'TikTok' : 'Video')
    };
}

function extractTikTokId(url) {
    const m = String(url || '').match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i) || String(url || '').match(/tiktok\.com\/.*?[?&]item_id=(\d+)/i);
    return m ? m[1] : '';
}

function extractDriveFileId(url) {
    const m = String(url || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([A-Za-z0-9_-]+)/i);
    return m ? m[1] : '';
}

function buildVideoEmbed(url) {
    const u = String(url || '');
    const yt = extractYouTubeId(u);
    if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${encodeURIComponent(yt)}?autoplay=0&playsinline=1&controls=1&rel=0&modestbranding=1` };
    const tt = extractTikTokId(u);
    if (tt) return { type: 'iframe', src: `https://www.tiktok.com/player/v1/${encodeURIComponent(tt)}?autoplay=0&description=1&music_info=1` };
    const driveId = extractDriveFileId(u);
    if (driveId) return { type: 'iframe', src: `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview` };
    return { type: 'video', src: u };
}

function openVideoModal(url, title = '') {
    const modal = document.getElementById('modal-video-player');
    const box = modal?.querySelector(':scope > div');
    const frame = document.getElementById('blanjaanplay-frame');
    const video = document.getElementById('blanjaanplay-video');
    const titleEl = document.getElementById('blanjaanplay-title');
    if (!modal || !box || !frame || !video) return;

    const embed = buildVideoEmbed(url);
    frame.src = '';
    frame.classList.add('hidden');
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.classList.add('hidden');

    if (embed.type === 'iframe') {
        frame.src = embed.src;
        frame.classList.remove('hidden');
    } else {
        video.src = embed.src;
        video.classList.remove('hidden');
        video.play().catch(() => {});
    }

    if (titleEl) titleEl.textContent = title || 'BlanjaanPlay';
    modal.classList.remove('hidden', 'pointer-events-none');
    setTimeout(() => { modal.classList.remove('opacity-0'); box.classList.remove('scale-95'); }, 10);
    document.body.classList.add('overflow-hidden');
}

function closeVideoModal() {
    const modal = document.getElementById('modal-video-player');
    const box = modal?.querySelector(':scope > div');
    const frame = document.getElementById('blanjaanplay-frame');
    const video = document.getElementById('blanjaanplay-video');
    if (!modal || !box) return;
    if (frame) { frame.src = ''; frame.classList.add('hidden'); }
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.classList.add('hidden'); }
    modal.classList.add('opacity-0', 'pointer-events-none');
    box.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 200);
    document.body.classList.remove('overflow-hidden');
}

async function loadVideoPromo() {
    try {
        let videos = await fetchAPI('videos');
        if (!Array.isArray(videos) || videos.length === 0) {
            try { videos = await fetchAPI('videoPromo'); } catch (_) {}
        }
        renderVideoPromo(Array.isArray(videos) ? videos : []);
    } catch (e) {
        renderVideoPromo([]);
    }
}

function renderVideoPromo(videos) {
    const container = document.getElementById('video-promo-container');
    if (!container) return;
    const items = Array.isArray(videos) ? videos.map(normalizeVideoItem).filter(v => v.url).slice(0, 10) : [];
    if (!items.length) {
        container.innerHTML = `<div class="w-full text-center py-10 text-xs text-gray-400">Belum ada video promo.</div>`;
        return;
    }
    container.innerHTML = items.map(v => `
        <button type="button" data-action="playVideo" data-payload="${escapeHTML(v.url)}" data-payload2="${escapeHTML(v.title || 'BlanjaanPlay')}" class="w-[125px] sm:w-[140px] md:w-[160px] lg:w-[180px] aspect-[9/16] flex-shrink-0 relative rounded-xl overflow-hidden shadow-sm bg-gray-900 group block text-left">
            <img src="${escapeHTML(v.thumbnail || FALLBACK_IMG)}" alt="${escapeHTML(v.title)}" class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition" loading="lazy" onerror="this.src='${FALLBACK_IMG}'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent"></div>
            <div class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[8px] font-bold">${escapeHTML(v.platform)}</div>
            <div class="absolute bottom-3 left-3 right-3 text-white">
                <div class="font-bold text-xs line-clamp-2 leading-tight drop-shadow-md">${escapeHTML(v.title || 'Video Promo')}</div>
                <div class="text-[9px] text-gray-300 mt-1 flex items-center gap-1"><i data-lucide="store" class="w-3 h-3"></i> ${escapeHTML(v.store || 'Toko UMKM')}</div>
            </div>
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none"><span class="w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center border border-white/30"><i data-lucide="play" class="w-5 h-5 fill-white"></i></span></div>
        </button>`).join('');
    lucide.createIcons();
}

// Product Details & Specs
async function recordClientProductView(pId) {
    try {
        const product = liveProducts.find(x => x.product_id === pId);
        if (isOwnSellerProduct(product)) return;
        const key = 'blanjaan_view_' + normalizeId(pId);
        const now = Date.now();
        const last = Number(sessionStorage.getItem(key) || 0);
        if (last && now - last < 30 * 60 * 1000) return;
        sessionStorage.setItem(key, String(now));
        const res = await fetchAPI('recordProductView', { product_id: pId });
        const p = liveProducts.find(x => x.product_id === pId);
        if (p && res?.views !== undefined) {
            p.views = Number(res.views) || 0;
            document.querySelectorAll('[data-product-view-count="' + CSS.escape(pId) + '"]').forEach(el => el.textContent = String(p.views));
        }
    } catch (e) {}
}

function renderProductSpecHtml(raw) {
    if (!raw) return '';
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (e) { return `<div class="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">${escapeHTML(raw)}</div>`; }
    }
    if (!obj || typeof obj !== 'object') return '';
    const labels = { size: 'Ukuran', color: 'Warna', type: 'Jenis', weight: 'Berat', level: 'Level' };
    const rows = [];
    Object.keys(labels).forEach(k => {
        if (obj[k] !== undefined && obj[k] !== '' && obj[k] !== null) {
            rows.push(`<div class="flex justify-between gap-4 py-1 border-b border-gray-50 last:border-0"><span class="text-gray-500">${labels[k]}</span><span class="font-medium text-gray-800 text-right">${escapeHTML(String(obj[k]))}${k === 'weight' ? ' gram' : ''}</span></div>`);
        }
    });
    return rows.length ? `<div class="text-sm">${rows.join('')}</div>` : '';
}

async function openProductDetail(pId) {
    currentSelectedVariant = null;
    const prod = liveProducts.find(p => p.product_id === pId);
    if (!prod) return showToast("Produk tidak ditemukan.", true);
    recordClientProductView(pId);
    document.getElementById('product-detail-content').innerHTML = `<div class="w-full h-80 md:h-[400px] skeleton"></div><div class="max-w-4xl mx-auto p-4"><div class="h-8 skeleton w-1/3 mb-3"></div><div class="h-4 skeleton w-2/3 mb-2"></div><div class="h-4 skeleton w-1/2"></div></div>`;
    switchView('view-product');

    const [seller, ratingSummary] = await Promise.all([
        getSeller(prod.seller_id),
        fetchAPI('getRatingSummary', { seller_id: prod.seller_id }).catch(() => ({ average: 0, count: 0 }))
    ]);

    const finalPrice = getFinalPrice(prod);
    const hasPromo = finalPrice < prod.price;
    const discountPercent = hasPromo ? Math.round(((prod.price - finalPrice) / prod.price) * 100) : 0;
    const activeFlashWindow = getActiveFlashWindow(prod);
    const effectiveStock = getEffectiveStock(prod);
    const stockInfo = getStockInfo(effectiveStock);
    const sellerLogo = seller && seller.logo ? seller.logo : 'https://placehold.co/100x100/FF6B00/ffffff?text=Toko';
    const sellerName = seller ? seller.name : 'Toko UMKM';
    const sellerLoc = seller ? seller.location : 'Indonesia';

    let websiteBtn = '';
    if (seller && seller.website) {
        websiteBtn = `<div class="px-4 pb-4 max-w-4xl mx-auto"><button data-action="openWebsite" data-payload="${escapeHTML(seller.website)}" class="w-full border border-gray-300 bg-white text-gray-700 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-50 active:scale-[0.98] transition shadow-sm"><i data-lucide="globe" class="w-4 h-4"></i> Kunjungi Website Resmi</button></div>`;
    }

    let variantHtml = '';
    if (prod.variants && Array.isArray(prod.variants) && prod.variants.length > 0) {
        variantHtml = `<div class="max-w-4xl mx-auto p-4 md:p-6 bg-white mb-2 shadow-sm"><h3 class="font-bold text-gray-800 text-sm md:text-base mb-3 flex items-center gap-2"><i data-lucide="layers" class="w-4 h-4 text-gray-400"></i> Pilih Varian Produk</h3><div class="flex flex-wrap gap-2" id="variant-container">`;
        prod.variants.forEach(v => {
            variantHtml += `<button data-action="selectVariant" data-payload="${escapeHTML(v)}" class="variant-btn border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:border-primary hover:text-primary transition bg-white active:scale-95 shadow-sm">${escapeHTML(v)}</button>`;
        });
        variantHtml += `</div></div>`;
    }

    const content = `
    <div class="w-full h-80 md:h-[400px] bg-white relative overflow-hidden flex justify-center border-b border-gray-200">
        <img src="${escapeHTML(prod.main_image)}" class="w-full lg:w-auto h-full object-cover lg:object-contain" onerror="this.src='${FALLBACK_IMG}'">
        ${!stockInfo.isAvailable ? '<div class="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm"><span class="bg-gray-800 border border-gray-700 text-white px-6 py-2 rounded-lg text-lg font-bold tracking-widest shadow-xl">STOK HABIS</span></div>' : ''}
    </div>
    <div class="w-full">
        <div class="max-w-4xl mx-auto p-4 md:p-6 bg-white mb-2 shadow-sm">
            <div class="flex items-center gap-2 mb-1">
                <div class="text-primary font-extrabold text-2xl md:text-3xl">${formatRupiah(finalPrice)}</div>
                ${hasPromo ? `<div class="bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-200 shadow-sm">${discountPercent}% OFF</div>` : ''}
            </div>
            ${hasPromo ? `<div class="text-sm text-gray-400 line-through mb-2">${formatRupiah(prod.price)}</div>` : ''}
            <h1 class="text-gray-800 text-base md:text-xl font-medium mt-1 leading-snug">${escapeHTML(prod.product_name)}</h1>
            <div class="mt-4 flex items-center gap-3 text-xs md:text-sm text-gray-500">
                <div class="flex items-center gap-1" data-rating-seller="${escapeHTML(prod.seller_id)}"><i data-lucide="star" class="w-4 h-4 text-yellow-400 fill-yellow-400"></i> <span class="font-bold text-gray-700">${ratingSummary.count ? Number(ratingSummary.average).toFixed(1) : '0.0'}</span><span class="text-gray-400">(${Number(ratingSummary.count || 0)})</span></div>
                <div class="w-1 h-1 bg-gray-300 rounded-full"></div><div class="flex items-center gap-1"><span class="font-medium text-gray-700" data-product-view-count="${escapeHTML(prod.product_id)}">${prod.views}</span> Dilihat</div>
                <div class="w-1 h-1 bg-gray-300 rounded-full"></div><div class="flex items-center gap-1 ${stockInfo.isAvailable ? 'text-green-600' : 'text-red-500'}"><i data-lucide="package" class="w-4 h-4"></i> ${escapeHTML(stockInfo.text)}</div>
            </div>
        </div>
        ${variantHtml}
        <div class="max-w-4xl mx-auto p-4 md:p-6 bg-white mb-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition shadow-sm" data-action="openSeller" data-payload="${escapeHTML(prod.seller_id)}">
            <div class="flex items-center gap-3"><div class="w-12 h-12 md:w-14 md:h-14 bg-gray-100 rounded-full flex items-center justify-center text-primary border border-gray-200 overflow-hidden flex-shrink-0"><img src="${escapeHTML(sellerLogo)}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><i data-lucide="store" class="w-6 h-6" style="display: ${seller && seller.logo ? 'none' : 'block'};"></i></div><div><div class="font-bold text-gray-800 text-sm md:text-base flex items-center gap-1">${escapeHTML(sellerName)} <i data-lucide="badge-check" class="w-4 h-4 text-blue-500 fill-blue-50"></i></div><div class="text-xs text-gray-500 flex items-center mt-0.5"><i data-lucide="map-pin" class="w-3 h-3 mr-1"></i> ${escapeHTML(sellerLoc)}</div></div></div><div class="text-xs border border-primary text-primary px-3 py-1.5 rounded-full font-bold shadow-sm">Kunjungi Toko</div>
        </div>
        ${websiteBtn}
        <div class="max-w-4xl mx-auto p-4 md:p-6 bg-white shadow-sm mb-6"><h3 class="font-bold text-gray-800 text-sm md:text-base mb-3 border-b pb-2 flex items-center gap-2"><i data-lucide="file-text" class="w-4 h-4 text-gray-400"></i> Detail Produk</h3><div class="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">${escapeHTML(prod.description) || "Penjual belum menambahkan deskripsi."}</div>${prod.specification ? `<h3 class="font-bold text-gray-800 text-sm md:text-base mt-6 mb-3 border-b pb-2 flex items-center gap-2"><i data-lucide="list" class="w-4 h-4 text-gray-400"></i> Spesifikasi</h3>${renderProductSpecHtml(prod.specification)}` : ''}</div>
    </div>`;
    document.getElementById('product-detail-content').innerHTML = content;

    const ownStore = isOwnSellerProduct(prod);
    let bAct = `<div data-action="chatProduct" data-payload="${escapeHTML(prod.seller_id)}" data-payload2="${escapeHTML(prod.product_name)}" class="flex-1 flex flex-col items-center justify-center border-r border-gray-200 bg-teal-50 text-teal-700 hover:bg-teal-100 cursor-pointer transition"><i data-lucide="message-square-more" class="w-5 h-5 mb-0.5 pointer-events-none"></i><span class="text-[10px] font-bold pointer-events-none">Chat</span></div>`;
    if (ownStore) {
        bAct += `<div class="flex-[3] flex flex-col items-center justify-center bg-gray-200 text-gray-500 cursor-not-allowed"><span class="text-sm font-bold">Toko Anda Sendiri</span></div>`;
    } else if (stockInfo.isAvailable) {
        bAct += `<div data-action="attemptAddToCart" data-payload="${escapeHTML(pId)}" class="flex-1 flex flex-col items-center justify-center bg-orange-50 hover:bg-orange-100 text-primary cursor-pointer transition border-r border-orange-100"><i data-lucide="shopping-cart" class="w-5 h-5 mb-0.5 pointer-events-none"></i><span class="text-[10px] font-bold pointer-events-none">Keranjang</span></div><div data-action="attemptOrderNow" data-payload="${escapeHTML(pId)}" class="flex-[2] flex flex-col items-center justify-center bg-primary text-white hover:bg-primaryDark cursor-pointer transition"><span class="text-sm font-bold pointer-events-none">Beli Sekarang</span></div>`;
    } else {
        bAct += `<div class="flex-[3] flex flex-col items-center justify-center bg-gray-300 text-gray-500 cursor-not-allowed"><span class="text-sm font-bold">Stok Habis</span></div>`;
    }
    document.getElementById('product-bottom-action').innerHTML = bAct;
    lucide.createIcons();
}

async function chatProduct(sId, pName) {
    const seller = await getSeller(sId);
    if (!seller || !seller.wa) return showToast("Nomor WhatsApp tidak valid.", true);
    window.open(`https://wa.me/${seller.wa}?text=${encodeURIComponent(`Halo *${seller.name}*, saya tertarik dengan *${pName}*. Apakah masih tersedia?`)}`, '_blank', 'noopener,noreferrer');
}

function openWebsite(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}

// Seller Public Page
async function openSellerPage(sId) {
    switchView('view-seller');
    const container = document.getElementById('seller-page-content');
    const backView = (sellerPreviewFromDashboard && authState.seller?.seller_id === sId) ? 'view-seller-dashboard' : 'view-home';
    const backBtn = document.getElementById('seller-page-back-button');
    if (backBtn) backBtn.setAttribute('data-payload', backView);
    container.innerHTML = `<div class="w-full h-32 skeleton relative"><div class="absolute -bottom-8 left-4 w-20 h-20 rounded-full border-4 border-white skeleton"></div></div><div class="pt-12 px-4 bg-white pb-4 shadow-sm mb-2"><div class="h-6 skeleton w-1/2 mb-2"></div></div><div class="px-2 py-4 grid grid-cols-2 gap-2">${renderProdSkeleton(4)}</div>`;
    window.scrollTo(0, 0);

    try {
        const [seller, ratingSummary] = await Promise.all([
            getSeller(sId),
            fetchAPI('getRatingSummary', { seller_id: sId }).catch(() => ({ average: 0, count: 0, ratings: [] }))
        ]);
        if (!seller) throw new Error("Not found");
        let sellerProducts = liveProducts.filter(p => p.seller_id === sId);
        try {
            const fresh = await fetchAPI('sellerProducts', { seller_id: sId, limit: 500, offset: 0 });
            if (Array.isArray(fresh)) {
                sellerProducts = normalizeProducts(fresh);
                liveProducts = liveProducts.filter(p => p.seller_id !== sId).concat(sellerProducts);
            }
        } catch (_) {}

        let productsHtml = sellerProducts.length === 0 ? `<div class="col-span-2 text-center py-10 text-gray-500 text-sm">Belum ada produk.</div>` : sellerProducts.map(createProductCard).join('');
        const bannerImg = seller.banner || FALLBACK_SELLER_BANNER;
        const logoImg = seller.logo || FALLBACK_LOGO;
        const reviews = Array.isArray(ratingSummary.ratings) ? ratingSummary.ratings : [];
        const reviewHtml = reviews.length ? reviews.slice(-5).reverse().map(r => `<div class="py-3 border-b border-gray-100 last:border-0"><div class="flex items-center justify-between"><div><div class="text-xs font-bold text-gray-800">${escapeHTML(r.reviewer_name || 'Pengguna')}</div><div class="text-sm font-bold text-gray-800 mt-0.5">${Number(r.stars || 0).toFixed(0)}.0 <span class="text-yellow-400">★</span></div></div><div class="text-[10px] text-gray-400">${escapeHTML(r.created_at_display || '')}</div></div><div class="text-xs text-gray-600 mt-1">${escapeHTML(r.review || 'Tanpa ulasan.')}</div></div>`).join('') : `<div class="text-xs text-gray-400 py-3">Belum ada ulasan.</div>`;

        container.innerHTML = `<div class="w-full h-32 md:h-48 bg-gray-200 relative"><img src="${escapeHTML(bannerImg)}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_IMG}'"><div class="absolute -bottom-8 left-4 w-20 h-20 md:w-28 md:h-28 rounded-full border-4 border-white bg-white shadow-sm overflow-hidden z-10 flex items-center justify-center"><img src="${escapeHTML(logoImg)}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><i data-lucide="store" class="w-8 h-8 text-primary" style="display: ${seller.logo ? 'none' : 'block'};"></i></div></div><div class="pt-10 md:pt-16 px-4 md:px-8 bg-white pb-4 md:pb-6 shadow-sm mb-2 relative z-0"><h1 class="font-bold text-xl md:text-2xl text-gray-800">${escapeHTML(seller.name)}</h1><div class="text-xs text-gray-500 flex items-center mt-1 mb-2"><i data-lucide="map-pin" class="w-3 h-3 mr-1"></i> ${escapeHTML(seller.location)}<span class="mx-2 text-gray-300">|</span><i data-lucide="box" class="w-3 h-3 mr-1"></i> ${sellerProducts.length} Produk</div><div class="flex items-center gap-1 text-sm mb-3" data-rating-seller="${escapeHTML(sId)}"><i data-lucide="star" class="w-4 h-4 text-yellow-400 fill-yellow-400"></i><span class="font-bold text-gray-800">${ratingSummary.count ? Number(ratingSummary.average).toFixed(1) : '0.0'}</span><span class="text-gray-400">(${Number(ratingSummary.count || 0)} penilaian)</span></div><div class="text-xs text-gray-600 mb-4 line-clamp-3">${escapeHTML(seller.description) || 'Tidak ada deskripsi.'}</div><div class="flex flex-wrap gap-2">${seller.wa ? `<button data-action="chatSeller" data-payload="${escapeHTML(sId)}" class="bg-[#25D366] text-white px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1 active:opacity-80 transition"><i data-lucide="message-circle" class="w-4 h-4 pointer-events-none"></i> Chat Toko</button>` : ''}${seller.website ? `<button data-action="openWebsite" data-payload="${escapeHTML(seller.website)}" class="border border-primary text-primary px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1 active:bg-orange-50 transition"><i data-lucide="globe" class="w-4 h-4 pointer-events-none"></i> Website</button>` : ''}</div></div><div class="px-3 md:px-6 py-3 bg-white mb-2"><h3 class="font-bold text-gray-800 text-sm mb-2 px-2">Ulasan Pembeli</h3><div class="px-2">${reviewHtml}</div></div><div class="px-2 md:px-6 py-3"><h3 class="font-bold text-gray-800 text-sm mb-3 px-2 border-b pb-2">Semua Produk Toko</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">${productsHtml}</div></div>`;
        lucide.createIcons();
    } catch (e) {
        container.innerHTML = `<div class="pt-20 text-center text-gray-500">Toko tidak ditemukan.</div>`;
    }
}

// Seller Dashboard
function renderSellerDashboard() {
    if (authState.status !== "AUTHENTICATED" || !authState.seller || authState.seller.status !== 'ACTIVE') return;
    const mySellerId = authState.seller.seller_id;
    const seenProducts = new Set();
    const myProducts = liveProducts.filter(p => p.seller_id === mySellerId && !seenProducts.has(p.product_id) && seenProducts.add(p.product_id));

    const totalProdEl = document.getElementById('sd-total-product');
    if (totalProdEl) totalProdEl.textContent = myProducts.length;
    const totalViews = myProducts.reduce((sum, p) => sum + (p.views || 0), 0);
    const totalViewsEl = document.getElementById('sd-total-views');
    if (totalViewsEl) totalViewsEl.textContent = totalViews;

    const catSelect = document.getElementById('sd-input-cat');
    if (catSelect) {
        catSelect.innerHTML = `<option value="">Pilih Kategori</option>` + liveCategories.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
    }

    const listCont = document.getElementById('sd-product-list');
    if (listCont) {
        if (myProducts.length === 0) {
            listCont.className = 'grid grid-cols-2 md:grid-cols-3 gap-3';
            listCont.innerHTML = `<div class="col-span-full bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center"><i data-lucide="package-open" class="w-10 h-10 text-gray-300 mx-auto mb-2"></i><div class="text-sm font-medium text-gray-800">Toko Anda Masih Kosong</div><div class="text-xs text-gray-500 mt-1 mb-4">Ayo mulai tambahkan produk pertamamu!</div><button data-action="openProductForm" data-payload="NEW" class="text-xs bg-primary text-white px-4 py-2 rounded-full font-bold shadow-sm inline-flex items-center gap-1 active:scale-95 transition"><i data-lucide="plus" class="w-3 h-3"></i> Tambah Produk</button></div>`;
        } else {
            listCont.className = 'grid grid-cols-2 md:grid-cols-3 gap-3';
            let html = '';
            myProducts.forEach(p => {
                const finalPrice = getFinalPrice(p);
                const stock = getStockInfo(p.stock);
                html += `<div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-full min-w-0"><div class="aspect-[4/3] md:aspect-square bg-gray-50 overflow-hidden"><img src="${escapeHTML(p.main_image)}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_IMG}'"></div><div class="p-2.5 flex flex-col flex-1"><h4 class="text-xs md:text-sm font-bold text-gray-800 line-clamp-2 min-h-[2.5rem]">${escapeHTML(p.product_name)}</h4><div class="text-sm font-bold text-primary mt-1">${formatRupiah(finalPrice)}</div><div class="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-gray-500"><span class="${stock.isAvailable ? 'text-green-600' : 'text-red-500'} font-medium truncate"><i data-lucide="box" class="w-3 h-3 inline mr-0.5"></i>${stock.isAvailable ? stock.maxQty + ' Stok' : 'Habis'}</span><span class="whitespace-nowrap"><i data-lucide="eye" class="w-3 h-3 inline mr-0.5"></i>${p.views}</span></div><div class="grid grid-cols-3 gap-1.5 mt-auto pt-2"><button data-action="openProductForm" data-payload="${escapeHTML(p.product_id)}" class="py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition" title="Edit"><i data-lucide="edit-3" class="w-4 h-4 mx-auto pointer-events-none"></i></button><button data-action="openFlashSale" data-payload="${escapeHTML(p.product_id)}" class="py-1.5 bg-orange-50 text-orange-600 rounded-md hover:bg-orange-100 transition" title="Ajukan Kejar Diskon"><i data-lucide="zap" class="w-4 h-4 mx-auto pointer-events-none"></i></button><button data-action="deleteProduct" data-payload="${escapeHTML(p.product_id)}" class="py-1.5 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4 mx-auto pointer-events-none"></i></button></div></div></div>`;
            });
            listCont.innerHTML = html;
        }
    }
    lucide.createIcons();
}

function openProductForm(pId) {
    const modal = document.getElementById('modal-product-form');
    const content = document.getElementById('modal-product-content');
    if (!modal || !content) return;
    document.getElementById('sd-form').reset();
    document.getElementById('sd-input-id').value = "";

    document.getElementById('sd-image-preview').classList.add('hidden');
    document.getElementById('sd-upload-placeholder').classList.remove('hidden');
    document.getElementById('sd-input-image').value = "";
    document.getElementById('sd-input-image-url').value = "";

    if (pId !== 'NEW') {
        const p = liveProducts.find(x => x.product_id === pId);
        if (p) {
            document.getElementById('sd-form-title').textContent = "Edit Etalase";
            document.getElementById('sd-input-id').value = p.product_id;
            document.getElementById('sd-input-name').value = p.product_name;
            document.getElementById('sd-input-cat').value = p.category_id || "";
            document.getElementById('sd-input-stock').value = p.stock || 0;
            document.getElementById('sd-input-price').value = p.price;
            document.getElementById('sd-input-promo').value = p.promo_price > 0 ? p.promo_price : "";
            document.getElementById('sd-input-desc').value = p.description || "";
            if (p.main_image) {
                document.getElementById('sd-input-image-url').value = p.main_image;
            }
        }
    } else {
        document.getElementById('sd-form-title').textContent = "Tambah Produk";
    }
    modal.classList.remove('hidden', 'pointer-events-none');
    setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('translate-y-full', 'scale-95'); }, 10);
}

function closeProductForm() {
    const modal = document.getElementById('modal-product-form');
    const content = document.getElementById('modal-product-content');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

async function saveProductFromDashboard(e) {
    e.preventDefault();
    const form = document.getElementById('sd-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = document.getElementById('sd-btn-save');
    const origText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>`;
    btn.disabled = true;
    lucide.createIcons();

    try {
        const pId = document.getElementById('sd-input-id').value;
        const catId = document.getElementById('sd-input-cat').value;
        const cat = liveCategories.find(c => c.id === catId) || {};
        await fetchAPI('upsertProduct', {
            session_token: authState.sessionToken,
            product_id: pId,
            category_id: catId,
            product_category: cat.name || 'Lainnya',
            product_name: document.getElementById('sd-input-name').value,
            stock: document.getElementById('sd-input-stock').value,
            price: document.getElementById('sd-input-price').value,
            promo_price: document.getElementById('sd-input-promo').value,
            main_image: document.getElementById('sd-input-image-url').value || FALLBACK_IMG,
            description: document.getElementById('sd-input-desc').value
        });
        closeProductForm();
        await loadCatalog();
        renderSellerDashboard();
        showToast(pId ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.');
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function deleteProductFromDashboard(pId) {
    try {
        await fetchAPI('deleteProduct', { session_token: authState.sessionToken, product_id: pId });
        liveProducts = liveProducts.filter(p => p.product_id !== pId);
        await loadCatalog();
        renderSellerDashboard();
        showToast('Produk berhasil dihapus.');
    } catch (err) {
        showToast(err.message, true);
    }
}

async function openSellerProfile() {
    const sId = authState.seller?.seller_id;
    if (!sId) return;
    let freshSeller = sellerCache[sId] || { seller_id: sId, name: authState.seller.store_name, store_name: authState.seller.store_name, description: '', logo: '', banner: '' };
    try {
        const remote = await fetchAPI('seller', { id: sId });
        const candidate = Array.isArray(remote) ? remote[0] : remote;
        if (candidate && candidate.seller_id) { freshSeller = cacheSellerData(candidate) || freshSeller; }
    } catch (e) { console.warn('[Seller Profile] refresh:', e?.message || e); }
    sellerCache[sId] = freshSeller;
    document.getElementById('sp-input-desc').value = freshSeller.description || '';
    document.getElementById('sp-logo-preview').src = profileInitialImage({ profile_image: freshSeller.logo }) || 'https://placehold.co/100x100/FF6B00/ffffff?text=Toko';
    document.getElementById('sp-logo-url').value = freshSeller.logo || '';
    document.getElementById('sp-logo-link').value = freshSeller.logo || '';
    if (freshSeller.banner) {
        document.getElementById('sp-banner-preview').src = profileInitialImage({ profile_image: freshSeller.banner });
        document.getElementById('sp-banner-preview').classList.remove('hidden');
        document.getElementById('sp-banner-placeholder').classList.add('hidden');
    } else {
        document.getElementById('sp-banner-preview').classList.add('hidden');
        document.getElementById('sp-banner-placeholder').classList.remove('hidden');
    }
    document.getElementById('sp-banner-url').value = freshSeller.banner || '';
    document.getElementById('sp-banner-link').value = freshSeller.banner || '';
    const modal = document.getElementById('modal-seller-profile'), content = document.getElementById('modal-seller-profile-content');
    modal.classList.remove('hidden', 'pointer-events-none');
    setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); }, 10);
    updateSellerLivePreview();
    lucide.createIcons();
}

function updateSellerLivePreview() {
    const seller = Object.assign({}, sellerCache[authState.seller?.seller_id] || {}, {
        seller_id: authState.seller?.seller_id || '',
        name: authState.seller?.store_name || sellerCache[authState.seller?.seller_id]?.name || 'Toko',
        store_name: authState.seller?.store_name || sellerCache[authState.seller?.seller_id]?.store_name || 'Toko',
        description: document.getElementById('sp-input-desc')?.value || sellerCache[authState.seller?.seller_id]?.description || '',
        logo: document.getElementById('sp-logo-link')?.value || document.getElementById('sp-logo-url')?.value || sellerCache[authState.seller?.seller_id]?.logo || '',
        banner: document.getElementById('sp-banner-link')?.value || document.getElementById('sp-banner-url')?.value || sellerCache[authState.seller?.seller_id]?.banner || ''
    });
    const products = liveProducts.filter(p => p.seller_id === seller.seller_id).slice(0, 4);
    const banner = seller.banner || FALLBACK_SELLER_BANNER;
    const logo = profileInitialImage({ profile_image: seller.logo }) || FALLBACK_LOGO;
    const phtml = products.length ? products.map(p => `<div class="border rounded-xl overflow-hidden bg-white"><img src="${escapeHTML(p.main_image || FALLBACK_IMG)}" class="w-full aspect-square object-cover"><div class="p-2"><div class="text-xs font-semibold line-clamp-2 h-8">${escapeHTML(p.product_name)}</div><div class="text-sm font-bold text-primary mt-1">${formatRupiah(getFinalPrice(p))}</div></div></div>`).join('') : '<div class="text-xs text-gray-400 py-10 text-center col-span-2">Belum ada produk.</div>';
    document.getElementById('seller-live-preview').innerHTML = `<div class="relative h-36 bg-gray-200"><img src="${escapeHTML(banner)}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_SELLER_BANNER}'"><div class="absolute -bottom-7 left-4 w-16 h-16 rounded-full border-4 border-white bg-white overflow-hidden shadow"><img src="${escapeHTML(logo)}" class="w-full h-full object-cover"></div></div><div class="pt-10 px-4 pb-4"><div class="font-bold text-lg text-gray-800">${escapeHTML(seller.name || seller.store_name || 'Toko')}</div><div class="text-xs text-gray-500 mt-1">${escapeHTML(seller.location || seller.city || '')}</div><div class="text-sm text-gray-600 mt-3 whitespace-pre-wrap">${escapeHTML(seller.description || 'Tidak ada deskripsi.')}</div></div><div class="bg-gray-50 px-3 py-3"><div class="text-sm font-bold text-gray-800 mb-2">Semua Produk Toko</div><div class="grid grid-cols-2 gap-2">${phtml}</div></div>`;
}

function closeSellerProfile() {
    const modal = document.getElementById('modal-seller-profile');
    const content = document.getElementById('modal-seller-profile-content');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

async function saveSellerProfileForm(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-seller-profile'), origText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto"></i>`;
    btn.disabled = true;
    lucide.createIcons();
    try {
        const logo = document.getElementById('sp-logo-link').value.trim() || document.getElementById('sp-logo-url').value.trim();
        const banner = document.getElementById('sp-banner-link').value.trim() || document.getElementById('sp-banner-url').value.trim();
        const res = await fetchAPI('updateSellerProfile', {
            session_token: authState.sessionToken,
            logo,
            banner,
            description: document.getElementById('sp-input-desc').value
        });
        if (res && res.seller) sellerCache[res.seller.seller_id] = res.seller;
        closeSellerProfile();
        await loadCatalog();
        renderSellerDashboard();
        showToast('Profil toko berhasil diperbarui.');
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function uploadSellerImageFile(file, field, fileInputId) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('File harus berupa gambar.', true);
    if (file.size > 4 * 1024 * 1024) return showToast('Ukuran gambar maksimal 4 MB.', true);
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const dataUrl = String(reader.result || ''), comma = dataUrl.indexOf(',');
            const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
            const res = await fetchAPI('uploadSellerImage', {
                session_token: authState.sessionToken,
                field,
                data_base64: base64,
                mime_type: file.type,
                filename: file.name
            });
            const url = res?.url || res?.seller?.[field] || '';
            if (field === 'logo') {
                document.getElementById('sp-logo-url').value = url;
                document.getElementById('sp-logo-link').value = url;
                document.getElementById('sp-logo-preview').src = url;
            } else {
                document.getElementById('sp-banner-url').value = url;
                document.getElementById('sp-banner-link').value = url;
                document.getElementById('sp-banner-preview').src = url;
                document.getElementById('sp-banner-preview').classList.remove('hidden');
                document.getElementById('sp-banner-placeholder').classList.add('hidden');
            }
            if (res?.seller) sellerCache[res.seller.seller_id] = res.seller;
            updateSellerLivePreview();
            showToast(field === 'logo' ? 'Logo toko berhasil disimpan.' : 'Banner toko berhasil disimpan.');
        } catch (err) {
            showToast(err.message, true);
        } finally {
            const el = document.getElementById(fileInputId);
            if (el) el.value = '';
        }
    };
    reader.onerror = () => showToast('Gagal membaca file gambar.', true);
    reader.readAsDataURL(file);
}

function handleLocalImageUpload(fileInputId, previewId, hiddenUrlId, placeholderId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput) return;
    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            const objectUrl = URL.createObjectURL(file);
            document.getElementById(hiddenUrlId).value = objectUrl;
            const preview = document.getElementById(previewId);
            preview.src = objectUrl;
            preview.classList.remove('hidden');
            if (placeholderId) {
                const placeholder = document.getElementById(placeholderId);
                if (placeholder) placeholder.classList.add('hidden');
            }
        }
    });
}


// Timer initializers
function initTimer() {
    const timerEl = document.getElementById('flash-sale-timer');
    if (!timerEl) return;
    const tick = () => {
        const now = Date.now();
        let active = null;
        for (const p of liveProducts) {
            const a = getActiveFlashWindow(p, now);
            if (a && (!active || new Date(a.end_at) < new Date(active.end_at))) active = a;
        }
        if (active) {
            timerEl.textContent = `Berakhir ${formatCountdownMs(new Date(active.end_at).getTime() - now)}`;
            timerEl.classList.remove('bg-gray-600');
            timerEl.classList.add('bg-red-600');
        } else {
            timerEl.textContent = 'Belum Aktif';
            timerEl.classList.remove('bg-red-600');
            timerEl.classList.add('bg-gray-600');
        }
    };
    tick();
    setInterval(tick, 1000);
}

function serviceStatusLabel(status) {
    const m = { ACTIVE: 'Aktif', APPROVED: 'Disetujui', PENDING: 'Menunggu', PENDING_ADMIN: 'Menunggu Admin', PENDING_PAYMENT: 'Menunggu Pembayaran', PAID: 'Lunas', REJECTED: 'Ditolak', EXPIRED: 'Berakhir', NOT_APPLIED: 'Belum Diajukan' };
    return m[String(status || 'NOT_APPLIED').toUpperCase()] || String(status || 'Belum Diajukan');
}

function serviceTypeLabel(type) {
    const m = { UMKM_TERPERCAYA: 'UMKM Terpercaya', UMKM_PILIHAN: 'UMKM Pilihan', FLASH_SALE: 'Kejar Diskon', BLANJAAN_PLAY: 'BlanjaanPlay', PAID_PACKAGE: 'Paket Berbayar' };
    return m[String(type || '').toUpperCase()] || type;
}

function renderSellerServiceStatus() {
    const c = document.getElementById('sd-service-status');
    if (!c) return;
    const rows = Array.isArray(authState.sellerServices) ? authState.sellerServices : [];
    c.innerHTML = rows.map(x => {
        const active = ['ACTIVE', 'APPROVED', 'PAID'].includes(String(x.status).toUpperCase());
        const apply = ['UMKM_TERPERCAYA', 'UMKM_PILIHAN', 'BLANJAAN_PLAY'].includes(x.service_type) && String(x.status).toUpperCase() === 'NOT_APPLIED';
        return `<div class="border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50 transition" data-action="openServiceDetail" data-payload="${escapeHTML(x.service_type)}"><div class="flex items-center justify-between gap-2"><div class="min-w-0"><div class="font-bold text-xs text-gray-800 truncate">${escapeHTML(serviceTypeLabel(x.service_type))}</div><div class="text-[10px] text-gray-400 truncate">${escapeHTML(x.package_name || '')}${x.service_type === 'PAID_PACKAGE' && x.amount ? ` · ${formatRupiah(Number(x.amount || 0))}` : ''}</div></div><span class="text-[10px] font-bold px-2 py-1 rounded-full ${active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}">${escapeHTML(serviceStatusLabel(x.status))}</span></div>${apply ? `<button data-action="openServiceApply" data-payload="${escapeHTML(x.service_type)}" class="mt-2 text-[10px] font-bold text-primary">Ajukan program →</button>` : ''}${x.details && x.details.length ? `<div class="text-[10px] text-gray-500 mt-1">${x.details.length} batch Kejar Diskon · klik untuk detail</div>` : ''}</div>`;
    }).join('') || '<div class="text-xs text-gray-400">Belum ada layanan.</div>';
}

async function openServiceDetail(serviceType) {
    const modal = document.getElementById('modal-service'), box = document.getElementById('modal-service-content'), body = document.getElementById('service-modal-body');
    if (!modal || !box || !body) return;
    body.innerHTML = '<div class="py-8 text-center text-sm text-gray-400">Memuat detail...</div>';
    modal.classList.remove('hidden', 'pointer-events-none');
    requestAnimationFrame(() => { modal.classList.remove('opacity-0'); box.classList.remove('translate-y-full', 'scale-95'); });
    try {
        const data = await fetchAPI('getSellerOverview', { session_token: authState.sessionToken });
        const s = (data.services || []).find(x => x.service_type === serviceType) || { service_type: serviceType, status: 'NOT_APPLIED', details: [] };
        document.getElementById('service-modal-title').textContent = serviceTypeLabel(serviceType);
        let html = `<div class="border rounded-xl p-4 bg-gray-50"><div class="flex items-center justify-between"><div class="font-bold text-sm">${escapeHTML(s.package_name || serviceTypeLabel(serviceType))}</div><span class="text-xs font-bold">${escapeHTML(serviceStatusLabel(s.status))}</span></div>${s.amount ? `<div class="text-xs text-gray-500 mt-1">Nilai: ${formatRupiah(Number(s.amount || 0))}</div>` : ''}${s.start_at ? `<div class="text-[10px] text-gray-500 mt-1">Mulai: ${new Date(s.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })}</div>` : ''}${s.end_at ? `<div class="text-[10px] text-gray-500">Berakhir: ${new Date(s.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false })}</div>` : ''}</div>`;
        if (serviceType === 'FLASH_SALE') {
            const rows = data.flash_details || s.details || [];
            html += `<div class="border rounded-xl overflow-hidden"><div class="px-4 py-3 font-bold text-sm">Detail Batch Kejar Diskon (${rows.length})</div><div class="max-h-72 overflow-y-auto divide-y">${rows.length ? rows.map(x => `<div class="px-4 py-3"><div class="font-bold text-xs">${escapeHTML(x.batch_name || x.batch_id)}</div><div class="text-[10px] text-gray-500">${x.start_at ? new Date(x.start_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'} - ${x.end_at ? new Date(x.end_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short', hour12: false }) : '-'}</div><div class="text-[10px] mt-1">${escapeHTML(x.status)} · Harga ${formatRupiah(x.promo_price || 0)} · Stok ${Number(x.promo_stock || 0)}</div></div>`).join('') : '<div class="p-4 text-xs text-gray-400">Belum ada batch.</div>'}</div></div>`;
        } else {
            html += `<div class="border rounded-xl p-4 text-xs text-gray-500">${s.application_id ? `Application: ${escapeHTML(s.application_id)}` : 'Belum ada pengajuan.'}</div>`;
        }
        body.innerHTML = html;
        lucide.createIcons();
    } catch (e) {
        body.innerHTML = `<div class="p-4 text-sm text-red-600">${escapeHTML(e.message || 'Gagal memuat detail.')}</div>`;
    }
}

function closeServiceModal() {
    const modal = document.getElementById('modal-service'), box = document.getElementById('modal-service-content');
    if (!modal || !box) return;
    modal.classList.add('opacity-0');
    box.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 220);
}

async function openServiceApply(type) {
    const m = document.getElementById('modal-service-apply'), b = document.getElementById('modal-service-apply-content');
    if (!m || !b) return;
    document.getElementById('service-apply-type').value = type;
    document.getElementById('service-apply-title').textContent = 'Ajukan ' + serviceTypeLabel(type);
    document.getElementById('service-apply-subtitle').textContent = 'Pilih paket atau gunakan kuota token.';
    const list = document.getElementById('service-package-list');
    list.innerHTML = '<div class="py-6 text-center text-xs text-gray-400">Memuat paket...</div>';
    m.classList.remove('hidden', 'pointer-events-none');
    requestAnimationFrame(() => { m.classList.remove('opacity-0'); b.classList.remove('translate-y-full', 'scale-95'); });
    try {
        if (type === 'UMKM_TERPERCAYA') {
            list.innerHTML = '<div class="border rounded-lg bg-green-50 p-3 text-xs text-gray-700"><b>Gratis.</b> Tidak ada pembayaran. Lengkapi dokumen/catatan verifikasi seller.</div>';
            document.getElementById('service-apply-submit').textContent = 'Kirim Pengajuan';
            document.getElementById('service-apply-notes').placeholder = 'Link dokumen NIB/KTP/pendukung atau keterangan verifikasi.';
        } else {
            const packs = await fetchAPI('getServicePackages', { session_token: authState.sessionToken, service_type: type }) || [];
            list.innerHTML = packs.length ? packs.map(p => `
                <label class="block border rounded-lg p-3 cursor-pointer">
                    <div class="flex items-start gap-2">
                        <input type="radio" name="service-package" value="${escapeHTML(p.package_id)}" class="mt-1" ${p.price <= 0 ? 'disabled' : ''}>
                        <span class="flex-1">
                            <span class="font-bold text-sm">${escapeHTML(p.package_name)}</span>
                            <span class="block text-xs text-gray-500 mt-1">${Number(p.token_qty || 0) ? Number(p.token_qty) + ' token · ' : ''}${Number(p.duration_days || 365)} hari</span>
                            <span class="block text-sm font-bold text-primary mt-1">${formatRupiah(p.price)}</span>
                            ${p.price <= 0 ? '<span class="block text-[10px] text-red-500 mt-1">Pricing belum diaktifkan admin.</span>' : ''}
                        </span>
                    </div>
                </label>`).join('') : '<div class="border rounded-lg p-4 text-xs text-gray-500 text-center">Belum ada paket aktif untuk program ini.</div>';
            document.getElementById('service-apply-submit').textContent = 'Bayar & Aktifkan';
        }
        lucide.createIcons();
    } catch (e) {
        list.innerHTML = `<div class="text-sm text-red-600">${escapeHTML(e.message || 'Gagal memuat paket.')}</div>`;
    }
}

function closeServiceApply() {
    const m = document.getElementById('modal-service-apply'), b = document.getElementById('modal-service-apply-content');
    if (!m || !b) return;
    m.classList.add('opacity-0');
    b.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => m.classList.add('hidden', 'pointer-events-none'), 220);
}

async function submitServiceApplication(e) {
    e.preventDefault();
    const btn = document.getElementById('service-apply-submit');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Memproses...';
    try {
        const type = document.getElementById('service-apply-type').value;
        if (type === 'UMKM_TERPERCAYA') {
            await fetchAPI('applySellerService', {
                session_token: authState.sessionToken,
                service_type: type,
                notes: document.getElementById('service-apply-notes').value
            });
            closeServiceApply();
            showToast('Pengajuan UMKM Terpercaya dikirim.');
        } else {
            const packageId = document.querySelector('input[name="service-package"]:checked')?.value;
            if (!packageId) throw new Error('Pilih paket terlebih dahulu.');
            const result = await fetchAPI('createServicePayment', {
                session_token: authState.sessionToken,
                package_id: packageId
            });
            if (result && (result.mode === 'UAT_DUMMY' || result.uat)) {
                closeServiceApply();
                openUatPaymentModal(result);
                return;
            }
            const client = await fetchAPI('getPaymentClientConfig', { session_token: authState.sessionToken });
            if (!client.enabled) throw new Error('Midtrans Client Key belum dikonfigurasi.');
            await loadMidtransSnap(client.client_key, client.environment);
            if (!window.snap || !result.snap_token) throw new Error('Token pembayaran Midtrans tidak diterima.');
            closeServiceApply();
            window.snap.pay(result.snap_token, {
                onSuccess: function () { showToast('Pembayaran diterima. Aktivasi program akan diproses otomatis.'); },
                onPending: function () { showToast('Pembayaran masih pending.'); },
                onError: function () { showToast('Pembayaran gagal.', true); }
            });
        }
        const me = await fetchAPI('authMe', { session_token: authState.sessionToken });
        authState.seller = me.seller || authState.seller;
        authState.sellerServices = me.seller_services || [];
        renderSellerDashboard();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = old;
    }
}

