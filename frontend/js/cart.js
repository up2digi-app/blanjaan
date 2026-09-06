/**
 * BLANJAAN v2.0 — Cart & Checkout Logic
 * Optimized with 2000ms aggressive debounce for server sync (Fase 3)
 */

let cartSyncTimer = null;
let cartSyncInFlight = false;
let cartSyncPromise = null;
let orderNowDebounce = false;

function getStockInfo(stockVal) {
    if (stockVal === undefined || stockVal === null || stockVal === "") {
        return { isAvailable: true, text: "Konfirmasi penjual", maxQty: Infinity };
    }
    const num = parseInt(stockVal, 10);
    if (isNaN(num)) return { isAvailable: true, text: "Konfirmasi penjual", maxQty: Infinity };
    if (num <= 0) return { isAvailable: false, text: "Habis", maxQty: 0 };
    return { isAvailable: true, text: `Stok: ${num}`, maxQty: num };
}

function loadOrderListSafely() {
    try {
        const data = localStorage.getItem('blanjaan_orders') || sessionStorage.getItem('blanjaan_orders');
        let parsed = data ? JSON.parse(data) : [];
        if (!Array.isArray(parsed)) throw new Error("Format invalid");
        const valid = [];
        parsed.forEach(item => {
            if (item && typeof item.productId === 'string' && Number.isInteger(item.qty) && item.qty > 0) {
                valid.push({
                    productId: normalizeId(item.productId),
                    variant: item.variant ? String(item.variant) : null,
                    qty: Math.min(item.qty, 999),
                    addedPrice: Number(item.addedPrice) || 0
                });
            }
        });
        const merged = {};
        valid.forEach(i => {
            const key = i.productId + (i.variant ? '::' + i.variant : '');
            if (merged[key]) merged[key].qty += i.qty;
            else merged[key] = i;
        });
        orderList = Object.values(merged);
    } catch (e) {
        localStorage.removeItem('blanjaan_orders');
        try { sessionStorage.removeItem('blanjaan_orders'); } catch (_) {}
        orderList = [];
    }
}

function buildCartSyncPayload() {
    return orderList.map(item => {
        const prod = liveProducts.find(p => p.product_id === item.productId);
        return {
            product_id: item.productId,
            seller_id: prod ? prod.seller_id : '',
            name: prod ? prod.product_name : item.productId,
            variant: item.variant || '',
            qty: Math.max(1, Number(item.qty || 1)),
            price: Number(item.addedPrice || (prod ? (typeof getFinalPrice === 'function' ? getFinalPrice(prod) : prod.price) : 0))
        };
    }).filter(item => item.seller_id && item.product_id);
}

/**
 * Fase 3 Optimization: Debounce agresif 2000ms
 */
function scheduleServerCartSync() {
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) return;
    clearTimeout(cartSyncTimer);
    cartSyncTimer = setTimeout(async () => {
        if (cartSyncInFlight) return;
        cartSyncInFlight = true;
        try {
            await fetchAPI('saveCart', {
                session_token: authState.sessionToken,
                items: buildCartSyncPayload()
            });
        } catch (e) {
            console.warn('[Cart Sync] Gagal menyimpan cart server:', e?.message || e);
        } finally {
            cartSyncInFlight = false;
        }
    }, 2000); // 2000ms debounce
}

/**
 * Non-blocking local storage update + debounced server sync
 */
function saveOrderList(syncServer = true) {
    localStorage.setItem('blanjaan_orders', JSON.stringify(orderList));
    try { sessionStorage.setItem('blanjaan_orders', JSON.stringify(orderList)); } catch (_) {}
    updateCartBadge();
    if (syncServer && authState.status === 'AUTHENTICATED' && authState.sessionToken) {
        scheduleServerCartSync();
    }
}

/**
 * Dipanggil secara eksklusif saat logout, checkout, atau page unload
 */
async function syncServerCartNow() {
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) return;
    clearTimeout(cartSyncTimer);
    if (cartSyncPromise) return cartSyncPromise;
    cartSyncPromise = (async () => {
        cartSyncInFlight = true;
        try {
            await fetchAPI('saveCart', {
                session_token: authState.sessionToken,
                items: buildCartSyncPayload()
            });
        } catch (e) {
            console.warn('[Cart Sync] Immediate error:', e?.message || e);
        } finally {
            cartSyncInFlight = false;
        }
    })();
    try { await cartSyncPromise; } finally { cartSyncPromise = null; }
}

async function hydrateServerCart() {
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) return;
    try {
        const res = await fetchAPI('getMyCart', { session_token: authState.sessionToken });
        const serverItems = Array.isArray(res?.items) ? res.items : [];
        if (!serverItems.length) {
            updateCartBadge();
            if (Array.isArray(orderList) && orderList.length) {
                await syncServerCartNow();
            }
            return;
        }

        const merged = {};
        (Array.isArray(orderList) ? orderList : []).forEach(item => {
            const key = String(item.productId || '') + '::' + String(item.variant || '');
            if (!item.productId) return;
            merged[key] = {
                productId: normalizeId(item.productId),
                variant: item.variant ? String(item.variant) : null,
                qty: Math.max(1, Number(item.qty || 1)),
                addedPrice: Number(item.addedPrice || 0)
            };
        });

        serverItems.forEach(item => {
            const productId = normalizeId(item.product_id);
            if (!productId) return;
            const variant = item.variant ? String(item.variant) : null;
            const key = productId + '::' + String(variant || '');
            const serverPrice = Number(item.price || 0);
            merged[key] = {
                productId,
                variant,
                qty: Math.max(1, Number(item.qty || 1)),
                addedPrice: serverPrice
            };
        });

        orderList = Object.values(merged);
        saveOrderList(false);
        if (document.getElementById('view-cart')?.classList.contains('active')) {
            await renderOrderList();
        }
    } catch (e) {
        console.warn('[Cart Sync] Gagal mengambil cart server:', e?.message || e);
        updateCartBadge();
    }
}

function isOwnSellerProduct(prod) {
    if (!prod || !authState.user) return false;
    const seller = sellerCache[prod.seller_id];
    const ownerId = normalizeId(seller?.owner_user_id);
    return !!ownerId && ownerId === normalizeId(authState.user.user_id);
}

function addToOrderList(pId, variant = null, silent = false) {
    const prod = liveProducts.find(p => p.product_id === pId);
    if (!prod) return;
    if (isOwnSellerProduct(prod)) return showToast('Anda tidak dapat memesan dari toko milik sendiri.', true);

    const stockVal = typeof getEffectiveStock === 'function' ? getEffectiveStock(prod) : prod.stock;
    const stockInfo = getStockInfo(stockVal);
    if (!stockInfo.isAvailable) return showToast("Stok produk habis.", true);

    const existing = orderList.find(i => i.productId === pId && i.variant === variant);
    const currentPrice = typeof getFinalPrice === 'function' ? getFinalPrice(prod) : (prod.promo_price > 0 ? prod.promo_price : prod.price);

    if (existing) {
        if (existing.qty < stockInfo.maxQty) {
            existing.qty += 1;
            existing.addedPrice = currentPrice;
        } else {
            return showToast(`Maksimal pesanan ${stockInfo.maxQty}`, true);
        }
    } else {
        orderList.push({ productId: pId, variant: variant, qty: 1, addedPrice: currentPrice });
        trackEvent('add_to_order_list', { productId: pId, variant: variant });
    }
    saveOrderList();
    if (!silent) showToast('Ditambahkan ke Keranjang');
}

function orderNow(pId, variant = null) {
    if (orderNowDebounce) return;
    orderNowDebounce = true;
    const existing = orderList.find(i => i.productId === pId && i.variant === variant);
    if (!existing) addToOrderList(pId, variant, true);
    switchView('view-cart');
    setTimeout(() => { orderNowDebounce = false; }, 1000);
}

function attemptCartAction(pId, isOrderNow) {
    const prod = liveProducts.find(p => p.product_id === pId);
    if (isOwnSellerProduct(prod)) return showToast('Anda tidak dapat memesan dari toko milik sendiri.', true);
    if (prod && prod.variants && Array.isArray(prod.variants) && prod.variants.length > 0) {
        if (!currentSelectedVariant) return showToast("Silakan pilih varian terlebih dahulu.", true);
    }
    if (isOrderNow) orderNow(pId, currentSelectedVariant);
    else addToOrderList(pId, currentSelectedVariant);
}

function updateCartBadge() {
    const total = orderList.reduce((sum, item) => sum + item.qty, 0);
    ['cart-badge-home', 'cart-badge-home-desktop', 'cart-badge-detail', 'cart-badge-seller'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (total > 0) {
                el.textContent = total;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

function updateQty(pId, variant, delta) {
    const item = orderList.find(i => i.productId === pId && i.variant === variant);
    if (!item) return;
    const prod = liveProducts.find(p => p.product_id === pId);
    const stockVal = typeof getEffectiveStock === 'function' ? getEffectiveStock(prod) : prod?.stock;
    const maxQty = prod ? getStockInfo(stockVal).maxQty : Infinity;
    const newQty = item.qty + delta;

    if (newQty <= 0) {
        orderList = orderList.filter(i => !(i.productId === pId && i.variant === variant));
        trackEvent('remove_from_order_list', { productId: pId, variant: variant });
    } else if (newQty > maxQty) {
        showToast(`Stok maksimal ${maxQty}`, true);
    } else {
        item.qty = newQty;
        trackEvent('update_order_quantity', { productId: pId, variant: variant, qty: newQty });
    }
    saveOrderList();
    if (document.getElementById('view-cart')?.classList.contains('active')) {
        renderOrderList();
    }
}

function removeInvalidItem(pId, variant) {
    orderList = orderList.filter(i => !(i.productId === pId && i.variant === variant));
    saveOrderList();
    renderOrderList();
}

function getRecentOutboundOrders() {
    try {
        const x = JSON.parse(localStorage.getItem('blanjaan_recent_outbound_orders') || '[]');
        return Array.isArray(x) ? x : [];
    } catch (e) { return []; }
}

function setRecentOutboundOrder(order) {
    const list = getRecentOutboundOrders().filter(x => x.order_id !== order.order_id);
    list.unshift(order);
    localStorage.setItem('blanjaan_recent_outbound_orders', JSON.stringify(list.slice(0, 20)));
}

function hasRatedOutboundOrder(orderId) {
    try {
        const x = JSON.parse(localStorage.getItem('blanjaan_rated_orders') || '[]');
        return Array.isArray(x) && x.includes(orderId);
    } catch (e) { return false; }
}

function markOutboundOrderRated(orderId) {
    try {
        const x = JSON.parse(localStorage.getItem('blanjaan_rated_orders') || '[]');
        const a = Array.isArray(x) ? x : [];
        if (!a.includes(orderId)) a.push(orderId);
        localStorage.setItem('blanjaan_rated_orders', JSON.stringify(a.slice(-100)));
    } catch (e) {}
}

async function hydrateRecentOutboundOrdersFromServer() {
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) return;
    try {
        const orders = await fetchAPI('getMyOrders', { session_token: authState.sessionToken });
        if (!Array.isArray(orders)) return;
        const existing = getRecentOutboundOrders();
        const map = {};
        existing.forEach(o => map[o.order_id] = o);
        orders.filter(o => String(o.status || '').toUpperCase() === 'CONTACTED').forEach(o => {
            const seller = sellerCache[o.seller_id] || {};
            map[o.order_id] = Object.assign({}, map[o.order_id] || {}, {
                order_id: o.order_id,
                seller_id: o.seller_id,
                seller_name: o.seller_name || seller.name || seller.store_name || 'Toko',
                total_items: Number(o.total_items || 0),
                total: Number(o.total || 0),
                whatsapp_opened_at: o.whatsapp_opened_at || o.updated_at,
                can_rate: o.can_rate !== undefined ? !!o.can_rate : (map[o.order_id]?.can_rate !== undefined ? map[o.order_id].can_rate : !hasRatedOutboundOrder(o.order_id))
            });
        });
        localStorage.setItem('blanjaan_recent_outbound_orders', JSON.stringify(
            Object.values(map).sort((a, b) => new Date(b.whatsapp_opened_at || 0) - new Date(a.whatsapp_opened_at || 0)).slice(0, 20)
        ));
    } catch (e) { console.warn('[Orders] hydrate outbound:', e?.message || e); }
}

async function renderOrderList() {
    const container = document.getElementById('cart-content');
    const emptyMsg = document.getElementById('empty-cart-msg');
    if (!container) return;

    if (orderList.length === 0) {
        const children = Array.from(container.children);
        children.forEach(c => { if (c.id !== 'empty-cart-msg') c.remove(); });
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        await hydrateRecentOutboundOrdersFromServer();
        const recent = getRecentOutboundOrders();
        if (recent.length) {
            const wrap = document.createElement('div');
            wrap.className = 'mt-6 space-y-3';
            wrap.innerHTML = '<h3 class="font-bold text-sm text-gray-800">Pesanan Terkirim</h3>' + recent.map(o => {
                const rated = !o.can_rate;
                return `<div class="bg-white rounded-lg border border-gray-100 shadow-sm p-4"><div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm text-gray-800">${escapeHTML(o.seller_name || 'Toko')}</div><div class="text-xs text-gray-500">${Number(o.total_items || 0)} barang · ${formatRupiah(o.total || 0)}</div><div class="text-[10px] text-green-600 font-bold mt-1">Pesanan dialihkan ke WhatsApp</div></div><button ${rated ? 'disabled' : ''} data-action="openRating" data-payload="${escapeHTML(o.seller_id)}" data-payload2="${escapeHTML(o.seller_name || 'Toko')}" data-payload3="${escapeHTML(o.order_id)}" class="px-3 py-2 rounded-lg text-xs font-bold ${rated ? 'bg-gray-100 text-gray-400' : 'bg-orange-50 text-primary'}">${rated ? 'Sudah Dinilai' : 'Nilai'}</button></div></div>`;
            }).join('');
            container.appendChild(wrap);
            lucide.createIcons();
        }
        return;
    }

    if (emptyMsg) emptyMsg.classList.add('hidden');
    container.innerHTML = `<div class="text-center py-10 md:py-20 text-gray-400 text-sm md:text-base"><i data-lucide="loader-2" class="w-8 h-8 animate-spin mx-auto mb-2"></i>Memuat Daftar...</div>`;
    lucide.createIcons();

    const grouped = {};
    let needsSave = false;

    for (let i = 0; i < orderList.length; i++) {
        const item = orderList[i];
        const liveP = liveProducts.find(p => p.product_id === item.productId);
        const varSuffix = item.variant ? ` (${item.variant})` : '';

        if (!liveP) {
            if (!grouped['INVALID']) grouped['INVALID'] = { isInvalid: true, items: [] };
            grouped['INVALID'].items.push({ ...item, invalidMsg: "Produk dihapus.", nameDisplay: `ID: ${item.productId}${varSuffix}` });
            continue;
        }

        const currentPrice = typeof getFinalPrice === 'function' ? getFinalPrice(liveP) : (liveP.promo_price > 0 ? liveP.promo_price : liveP.price);
        if (item.addedPrice !== currentPrice) {
            item.addedPrice = currentPrice;
            needsSave = true;
        }

        const stockVal = typeof getEffectiveStock === 'function' ? getEffectiveStock(liveP) : liveP.stock;
        const stockInfo = getStockInfo(stockVal);
        if (item.qty > stockInfo.maxQty) {
            item.qty = stockInfo.maxQty;
            needsSave = true;
        }

        if (item.qty <= 0) {
            if (!grouped['INVALID']) grouped['INVALID'] = { isInvalid: true, items: [] };
            grouped['INVALID'].items.push({ ...item, invalidMsg: "Stok habis.", nameDisplay: liveP.product_name + varSuffix });
            continue;
        }

        const sId = liveP.seller_id;
        if (!grouped[sId]) {
            const sInfo = await getSeller(sId);
            grouped[sId] = { sellerInfo: sInfo || { name: "Toko", wa: null }, items: [], total: 0 };
        }
        grouped[sId].items.push({ ...item, liveData: liveP, priceChanged: false });
        grouped[sId].total += (currentPrice * item.qty);
    }

    if (needsSave) saveOrderList();

    let html = '';
    if (grouped['INVALID']) {
        html += `<div class="bg-red-50 rounded-lg p-3 mb-4 border border-red-200 shadow-sm"><div class="text-red-500 font-bold text-xs mb-2 flex items-center"><i data-lucide="alert-triangle" class="w-4 h-4 mr-1"></i> Tidak Valid</div>`;
        grouped['INVALID'].items.forEach(it => {
            html += `<div class="flex justify-between items-center text-xs text-gray-600 mb-2 border-b border-red-100 pb-2 last:border-0 last:pb-0"><div class="pr-2"><div class="font-semibold line-clamp-1">${escapeHTML(it.nameDisplay)}</div><div class="text-[10px] text-red-400">${escapeHTML(it.invalidMsg)}</div></div><button data-action="removeInvalid" data-payload="${escapeHTML(it.productId)}::${escapeHTML(it.variant || '')}" class="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded whitespace-nowrap">Hapus</button></div>`;
        });
        html += `</div>`;
    }

    for (const sId in grouped) {
        if (sId === 'INVALID') continue;
        const group = grouped[sId];
        html += `<div class="bg-white rounded-lg shadow-sm p-4 mb-4 border border-gray-100"><div class="flex items-center gap-2 border-b pb-2 mb-3"><i data-lucide="store" class="w-4 h-4 text-gray-500"></i><button type="button" data-action="openSeller" data-payload="${escapeHTML(sId)}" class="font-bold text-sm text-gray-800 hover:text-primary text-left truncate">${escapeHTML(group.sellerInfo.name)}</button></div>`;
        group.items.forEach(it => {
            const p = it.liveData;
            const price = typeof getFinalPrice === 'function' ? getFinalPrice(p) : (p.promo_price > 0 ? p.promo_price : p.price);
            const variantText = it.variant ? `<div class="text-[10px] font-bold text-gray-600 mt-1.5 bg-gray-100 inline-block px-2 py-0.5 rounded border border-gray-200">Varian: ${escapeHTML(it.variant)}</div>` : '';
            html += `<div class="flex gap-3 mb-4"><img src="${escapeHTML(p.main_image)}" class="w-16 h-16 object-cover rounded-md border" onerror="this.src='${FALLBACK_IMG}'"><div class="flex-1 flex flex-col justify-between"><div><button type="button" data-action="openProduct" data-payload="${escapeHTML(p.product_id)}" class="text-xs md:text-sm text-gray-800 line-clamp-2 leading-tight text-left hover:text-primary">${escapeHTML(p.product_name)}</button>${variantText}</div><div class="flex items-center justify-between mt-2"><span class="text-primary font-bold">${formatRupiah(price)}</span><div class="flex items-center border rounded-md"><button class="px-2 py-1 bg-gray-50 text-gray-600" data-action="updateQty" data-payload="${escapeHTML(p.product_id)}::${escapeHTML(it.variant || '')}" data-payload2="-1"><i data-lucide="minus" class="w-3 h-3"></i></button><span class="px-3 py-1 text-xs font-bold border-x">${it.qty}</span><button class="px-2 py-1 bg-gray-50 text-gray-600" data-action="updateQty" data-payload="${escapeHTML(p.product_id)}::${escapeHTML(it.variant || '')}" data-payload2="1"><i data-lucide="plus" class="w-3 h-3"></i></button></div></div></div></div>`;
        });
        html += `<div class="border-t pt-3 mt-2 flex flex-col gap-3"><div class="flex justify-between items-center"><div class="text-xs text-gray-500">Estimasi Total:</div><div class="font-bold text-primary text-base">${formatRupiah(group.total)}</div></div><div class="flex gap-2 w-full">
            <button data-action="openRating" data-payload="${escapeHTML(sId)}" data-payload2="${escapeHTML(group.sellerInfo.name)}" class="bg-orange-50 hover:bg-orange-100 text-primary px-3 md:px-4 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 active:opacity-80 transition flex-shrink-0 border border-orange-100"><i data-lucide="star" class="w-4 h-4 pointer-events-none"></i> <span class="pointer-events-none hidden sm:inline">Nilai</span></button>
            <button data-action="openCheckoutModal" data-payload="${escapeHTML(sId)}" class="flex-1 bg-[#25D366] hover:bg-[#21b858] text-white px-4 py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 active:opacity-80 transition shadow-sm"><i data-lucide="phone" class="w-4 h-4 pointer-events-none"></i> <span class="pointer-events-none">Pesan via WhatsApp</span></button>
            </div></div></div>`;
    }

    container.innerHTML = html;
    if (emptyMsg) container.appendChild(emptyMsg);
    lucide.createIcons();
}

function openCheckoutModal(sId) {
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) {
        intentAfterLogin = 'view-cart';
        return switchView('view-account');
    }
    const ownProduct = orderList.some(item => {
        const p = liveProducts.find(x => x.product_id === item.productId);
        return p && String(p.seller_id) === String(sId) && isOwnSellerProduct(p);
    });
    if (ownProduct) return showToast('Anda tidak dapat memesan dari toko milik sendiri.', true);

    document.getElementById('checkout-seller-id').value = sId;
    document.getElementById('checkout-notes').value = "";
    const buyerNameEl = document.getElementById('checkout-buyer-name');
    const totalItemsEl = document.getElementById('checkout-total-items');
    const shippingFeeEl = document.getElementById('checkout-shipping-fee');
    if (buyerNameEl) buyerNameEl.value = authState.user?.display_name || authState.user?.email || 'Buyer';
    if (totalItemsEl) {
        totalItemsEl.value = orderList.filter(item => liveProducts.some(p => p.product_id === item.productId && p.seller_id === sId)).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    }
    if (shippingFeeEl) shippingFeeEl.value = '';
    if (authState.status === "AUTHENTICATED" && authState.user && authState.user.address) {
        document.getElementById('checkout-address').value = authState.user.address;
    } else {
        document.getElementById('checkout-address').value = "";
    }

    const modal = document.getElementById('modal-checkout');
    const content = document.getElementById('modal-checkout-content');
    modal.classList.remove('hidden', 'pointer-events-none');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('translate-y-full', 'scale-95');
    }, 10);
}

function closeCheckoutModal() {
    const modal = document.getElementById('modal-checkout');
    const content = document.getElementById('modal-checkout-content');
    modal.classList.add('opacity-0');
    content.classList.add('translate-y-full', 'scale-95');
    setTimeout(() => { modal.classList.add('hidden', 'pointer-events-none'); }, 300);
}

async function checkoutWA(e) {
    e.preventDefault();
    if (isCheckoutProcessing) return;
    const sId = document.getElementById('checkout-seller-id').value;
    const preflightOwn = orderList.some(item => {
        const p = liveProducts.find(x => x.product_id === item.productId);
        return p && String(p.seller_id) === String(sId) && isOwnSellerProduct(p);
    });
    if (preflightOwn) return showToast('Anda tidak dapat memesan dari toko milik sendiri.', true);
    if (authState.status !== 'AUTHENTICATED' || !authState.sessionToken) {
        return showToast('Silakan login terlebih dahulu untuk melanjutkan pemesanan.', true);
    }

    const address = document.getElementById('checkout-address').value.trim();
    const notes = document.getElementById('checkout-notes').value.trim();
    const buyerName = document.getElementById('checkout-buyer-name')?.value?.trim() || authState.user?.display_name || authState.user?.email || 'Buyer';
    const totalItems = Number(document.getElementById('checkout-total-items')?.value || 0);
    const shippingFee = Number(document.getElementById('checkout-shipping-fee')?.value || 0);
    if (!address) return showToast("Alamat pengiriman wajib diisi.", true);

    const btn = document.getElementById('btn-submit-checkout');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Memproses...`;
    btn.classList.add('opacity-70', 'cursor-not-allowed');
    btn.disabled = true;
    isCheckoutProcessing = true;

    try {
        const seller = await getSeller(sId);
        if (!seller || !seller.wa) throw new Error("Nomor WA toko tidak valid.");

        const freshProducts = await fetchAPI("products");
        const fpNorm = normalizeProducts(freshProducts);
        liveProducts = fpNorm;

        let validItems = [];
        let total = 0;
        let needsSave = false;

        orderList.forEach(item => {
            const lp = fpNorm.find(p => p.product_id === item.productId && p.seller_id === sId);
            if (lp) {
                const stock = getStockInfo(lp.stock);
                if (stock.maxQty > 0) {
                    const price = typeof getFinalPrice === 'function' ? getFinalPrice(lp) : (lp.promo_price > 0 ? lp.promo_price : lp.price);
                    if (item.addedPrice !== price || item.qty > stock.maxQty) needsSave = true;
                    const finalQty = Math.min(item.qty, stock.maxQty);
                    item.qty = finalQty;
                    item.addedPrice = price;
                    const vText = item.variant ? ` (Varian: ${item.variant})` : '';
                    validItems.push({ name: lp.product_name + vText, qty: finalQty, price: price });
                    total += (finalQty * price);
                } else needsSave = true;
            } else {
                const existsGlobal = fpNorm.find(p => p.product_id === item.productId);
                if (!existsGlobal || existsGlobal.seller_id !== sId) needsSave = true;
            }
        });

        if (needsSave) saveOrderList();
        if (validItems.length === 0) {
            renderOrderList();
            closeCheckoutModal();
            throw new Error("Produk tidak valid.");
        }

        let text = `Halo *${seller.name}*,\n\nSaya ingin memesan melalui *BLANJAAN*:\n\n`;
        validItems.forEach((item, index) => {
            text += `${index + 1}. *${item.name}*\n   Jumlah: ${item.qty}\n   Subtotal: ${formatRupiah(item.price * item.qty)}\n\n`;
        });
        text += `Nama Buyer: ${buyerName}\nJumlah Barang: ${totalItems}\nSubtotal Produk: ${formatRupiah(total)}\nBiaya Kirim: ${shippingFee ? formatRupiah(shippingFee) : 'Belum ditentukan'}\n\nAlamat Pengiriman:\n${address}\n\n`;
        if (notes) text += `Catatan:\n${notes}\n\n`;
        text += `Mohon konfirmasi ketersediaan & total pembayaran.\nTerima kasih.\n\n--------------------------------\n${appConfig.WA_BRAND_FOOTER || appConfig.BRAND_MESSAGE_FOOTER || 'Pesanan melalui BLANJAAN'}\n${appConfig.WA_BRAND_URL || appConfig.BRAND_URL || 'https://blanjaan.up2digital.workers.dev'}\n--------------------------------`;

        await syncServerCartNow();
        const savedOrder = await fetchAPI('createOrder', {
            session_token: authState.sessionToken,
            seller_id: sId,
            buyer_name: buyerName,
            total_items: totalItems,
            shipping_fee: shippingFee,
            address,
            notes,
            items: validItems,
            total
        });

        if (!savedOrder?.order_id) throw new Error('Order tidak berhasil dibuat.');

        try {
            await fetchAPI('markOrderWhatsappOpened', {
                session_token: authState.sessionToken,
                order_id: savedOrder.order_id
            });
        } catch (e) {
            console.warn('[Order] mark outbound gagal:', e?.message || e);
        }

        trackEvent('click_order_whatsapp', { sellerId: sId, item_count: validItems.length, orderId: savedOrder.order_id });
        const waUrl = `https://wa.me/${seller.wa}?text=${encodeURIComponent(text)}`;
        try { window.open(waUrl, '_blank', 'noopener,noreferrer'); } catch (e) { console.warn('[WhatsApp] popup:', e); }

        orderList = [];
        localStorage.removeItem('blanjaan_orders');
        try { sessionStorage.removeItem('blanjaan_orders'); } catch (_) {}
        updateCartBadge();

        closeCheckoutModal();
        setRecentOutboundOrder({
            order_id: savedOrder.order_id,
            seller_id: sId,
            seller_name: seller.name,
            total_items: totalItems,
            total,
            whatsapp_opened_at: new Date().toISOString(),
            can_rate: true
        });

        await hydrateRecentOutboundOrdersFromServer();
        await renderOrderList();
        if (typeof renderAccountOrderHistory === 'function') {
            await renderAccountOrderHistory();
        }
        showToast('Pesanan siap dikirim ke WhatsApp. Keranjang sudah dikosongkan.');
    } catch (error) {
        showToast(error.message, true);
    } finally {
        isCheckoutProcessing = false;
        btn.innerHTML = origHtml;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
        btn.disabled = false;
        lucide.createIcons();
    }
}
