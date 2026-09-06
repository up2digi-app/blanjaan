/**
 * BLANJAAN v2.0 — Main App Initialization & Global Event Delegation
 */

function handleGlobalClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const payload = target.getAttribute('data-payload');
    const payload2 = target.getAttribute('data-payload2');
    const payload3 = target.getAttribute('data-payload3');

    switch (action) {
        // Navigation & Views
        case 'switchView':
            if (payload === 'view-home') sellerPreviewFromDashboard = false;
            switchView(payload);
            break;
        case 'openProduct': openProductDetail(payload); break;
        case 'filterCategory': filterCategory(payload, payload2); break;
        case 'setFilter': handleSetFilter(payload); break;
        case 'openSeller': openSellerPage(payload); break;
        case 'openWebsite': openWebsite(payload); break;
        case 'chatProduct': chatProduct(payload, payload2); break;
        case 'chatSeller': chatProduct(payload, "Produk di Toko Anda"); break;
        case 'handleMitraNav': handleMitraNav(); break;
        case 'startMitraFlow': handleMitraNav(); break;

        // Search
        case 'doSearch': {
            const q = document.getElementById('searchInput')?.value;
            if (q && q.trim().length > 0) executeSearch(q);
            break;
        }
        case 'doSearchQuick': {
            const input = document.getElementById('searchInput');
            if (input) input.value = payload;
            executeSearch(payload);
            break;
        }
        case 'closeSearch': {
            const input = document.getElementById('searchInput');
            if (input) input.value = "";
            switchView('view-home');
            break;
        }

        // Cart & Order
        case 'selectVariant':
            currentSelectedVariant = payload;
            document.querySelectorAll('.variant-btn').forEach(b => {
                b.classList.remove('border-primary', 'bg-orange-50', 'text-primary');
                b.classList.add('border-gray-300', 'text-gray-700', 'bg-white');
            });
            target.classList.add('border-primary', 'bg-orange-50', 'text-primary');
            target.classList.remove('border-gray-300', 'text-gray-700', 'bg-white');
            break;
        case 'attemptAddToCart': attemptCartAction(payload, false); break;
        case 'attemptOrderNow': attemptCartAction(payload, true); break;
        case 'addToCart': addToOrderList(payload); break;
        case 'orderNow': orderNow(payload); break;
        case 'updateQty': {
            const parts = payload.split('::');
            updateQty(parts[0], parts[1] === '' ? null : parts[1], parseInt(payload2));
            break;
        }
        case 'removeInvalid': {
            const parts = payload.split('::');
            removeInvalidItem(parts[0], parts[1] === '' ? null : parts[1]);
            break;
        }
        case 'checkoutWA': checkoutWA(payload); break;
        case 'openCheckoutModal': openCheckoutModal(payload); break;
        case 'closeCheckoutModal': closeCheckoutModal(); break;

        // Auth & Account
        case 'cancelLogin':
            pendingLoginEmail = "";
            renderAccountState();
            break;
        case 'doLogout': handleLogout(); break;
        case 'loginWithOtp': {
            const email = pendingLoginEmail || document.getElementById('loginEmail')?.value?.trim();
            if (email) {
                pendingLoginEmail = email;
                fetchAPI('authRequestOtp', { email })
                    .then(res => renderOtpState(res.resend_after_seconds || 60))
                    .catch(err => showToast(err.message, true));
            }
            break;
        }
        case 'forgotPasswordGuest': requestPasswordReset(); break;
        case 'managePassword': openPasswordModal('set'); break;
        case 'forgotPassword': requestPasswordReset(); break;
        case 'togglePassword': {
            const el = document.getElementById(payload);
            if (el) {
                el.type = el.type === 'password' ? 'text' : 'password';
                const icon = target.querySelector('[data-lucide]');
                if (icon) icon.setAttribute('data-lucide', el.type === 'password' ? 'eye' : 'eye-off');
                lucide.createIcons();
            }
            break;
        }
        case 'closePasswordModal': closePasswordModal(); break;
        case 'editProfile': renderEditProfile(); break;
        case 'cancelEditProfile': renderAccountState(); break;

        // Ratings & Video
        case 'openRating': openRatingModal(payload, payload2, payload3); break;
        case 'closeRating': closeRatingModal(); break;
        case 'setStar': setRatingStar(parseInt(payload)); break;
        case 'submitRating': submitSellerRating(); break;
        case 'playVideo': openVideoModal(payload, payload2); break;
        case 'closeVideoModal': closeVideoModal(); break;
        case 'toggleVideoMute': {
            const vid = document.getElementById(payload);
            const btn = document.getElementById('btn-mute-' + payload);
            if (vid && btn) {
                vid.muted = !vid.muted;
                btn.innerHTML = vid.muted ? '<i data-lucide="volume-x" class="w-4 h-4"></i>' : '<i data-lucide="volume-2" class="w-4 h-4 text-green-400"></i>';
                lucide.createIcons();
            }
            break;
        }

        // Seller Dashboard
        case 'openSellerDashboard':
            if (hasAdminRoleClient()) return showToast('Akun ADMIN tidak dapat membuka toko.', true);
            switchView('view-seller-dashboard');
            fetchAPI('authMe', { session_token: authState.sessionToken }).then(me => {
                authState.seller = me.seller || authState.seller;
                authState.sellerServices = me.seller_services || [];
                renderSellerDashboard();
            }).catch(() => renderSellerDashboard());
            break;
        case 'openProductForm': openProductForm(payload); break;
        case 'closeProductForm': closeProductForm(); break;
        case 'deleteProduct': deleteProductFromDashboard(payload); break;
        case 'openSellerProfile': openSellerProfile(); break;
        case 'previewMyStore':
            if (authState.seller?.seller_id) {
                sellerPreviewFromDashboard = true;
                openSellerPage(authState.seller.seller_id);
            }
            break;
        case 'closeSellerProfile': closeSellerProfile(); break;

        // Seller Services & Flash Sale
        case 'openFlashSale': openFlashSaleModal(payload); break;
        case 'openFlashTokenPurchase': openFlashTokenPurchase(1, 0); break;
        case 'closeFlashSaleModal': closeFlashSaleModal(); break;
        case 'openServiceDetail': openServiceDetail(payload); break;
        case 'closeServiceModal': closeServiceModal(); break;
        case 'openServiceApply': openServiceApply(payload); break;
        case 'closeServiceApply': closeServiceApply(); break;

        // Admin Workflows
        case 'openAdminDashboard': void openAdminDashboard(); break;
        case 'refreshAdminDashboard': void refreshAdminDashboard().catch(() => {}); break;
        case 'adminReviewSeller': adminReviewSeller(payload, payload2); break;
        case 'adminApproveFlash': adminApproveFlash(payload); break;
        case 'adminRejectFlash': adminRejectFlash(payload); break;
        case 'adminEditBatch': openAdminBatchModal(payload, 'edit'); break;
        case 'adminDeleteBatch': openAdminBatchModal(payload, 'delete'); break;
        case 'closeAdminBatchModal': closeAdminBatchModal(); break;
        case 'openAdminSellerDetail': openAdminSellerDetail(payload); break;
        case 'closeAdminSellerDetail': closeAdminSellerDetail(); break;
        case 'adminApproveService': reviewAdminService(payload, 'APPROVE'); break;
        case 'adminRejectService': reviewAdminService(payload, 'REJECT'); break;
        case 'adminApprovePromotion': reviewAdminPromotion(payload, 'APPROVE'); break;
        case 'adminRejectPromotion': reviewAdminPromotion(payload, 'REJECT'); break;
        case 'adminMarkUatPaid': void adminMarkUatPaid(payload); break;
        case 'refreshPolicyReview': void refreshPolicyReview(); break;
        case 'adminPolicyApprove': void reviewProductPolicyClient(payload, 'APPROVE'); break;
        case 'adminPolicyBlock': void reviewProductPolicyClient(payload, 'BLOCK'); break;

        // Admin Hero Banner CRUD
        case 'openAdminBannerModal': openAdminBannerModal(); break;
        case 'adminEditBanner': openAdminBannerModal(payload); break;
        case 'adminDeleteBanner': deleteAdminBanner(payload); break;
        case 'closeAdminBannerModal': closeAdminBannerModal(); break;
    }
}

function persistCartBeforeNavigation() {
    try { localStorage.setItem('blanjaan_orders', JSON.stringify(orderList || [])); } catch (_) {}
    try { sessionStorage.setItem('blanjaan_orders', JSON.stringify(orderList || [])); } catch (_) {}
    if (authState.status === 'AUTHENTICATED' && authState.sessionToken) {
        try { localStorage.setItem('blanjaan_cart_sync_pending', '1'); } catch (_) {}
    }
}

function initCarousel() {
    const track = document.getElementById('carousel-track');
    const dots = document.getElementById('carousel-indicators')?.children;
    if (!track || !dots) return;
    let currentIndex = 0;
    setInterval(() => {
        if (!dots.length) return;
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

function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(() => console.log('[PWA] Service Worker registered successfully.'))
            .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
    }
}

async function initApp() {
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.addEventListener('click', handleGlobalClick);

    // Filter and form listeners
    document.getElementById('admin-flash-filter-q')?.addEventListener('input', () => renderAdminFlashApplications(adminFlashApplicationsCache));
    document.getElementById('admin-flash-filter-status')?.addEventListener('change', () => renderAdminFlashApplications(adminFlashApplicationsCache));
    document.getElementById('service-apply-form')?.addEventListener('submit', submitServiceApplication);
    document.getElementById('mitraForm')?.addEventListener('submit', submitMitra);
    document.getElementById('sd-form')?.addEventListener('submit', saveProductFromDashboard);
    document.getElementById('form-seller-profile')?.addEventListener('submit', saveSellerProfileForm);
    document.getElementById('form-checkout')?.addEventListener('submit', checkoutWA);
    document.getElementById('form-flash-sale')?.addEventListener('submit', submitFlashSaleForm);
    document.getElementById('form-admin-batch')?.addEventListener('submit', createAdminBatch);
    document.getElementById('form-admin-batch-modal')?.addEventListener('submit', submitAdminBatchModal);
    document.getElementById('modal-admin-batch')?.addEventListener('click', e => { if (e.target.id === 'modal-admin-batch') closeAdminBatchModal(); });
    document.getElementById('form-password')?.addEventListener('submit', savePassword);
    document.getElementById('form-password-otp')?.addEventListener('submit', resetPassword);
    document.getElementById('modal-password')?.addEventListener('click', closePasswordFromOutside);

    // Hero Banner & Token Tarif forms
    document.getElementById('form-admin-banner')?.addEventListener('submit', saveAdminBanner);
    document.getElementById('form-admin-token-tarif')?.addEventListener('submit', saveAdminTokenTarif);

    // Search enter key
    document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = e.target.value;
            if (q.trim().length > 0) executeSearch(q);
        }
    });

    // Image upload handlers
    handleLocalImageUpload('sd-file-image', 'sd-image-preview', 'sd-input-image', 'sd-upload-placeholder');
    document.getElementById('sp-logo-file')?.addEventListener('change', e => uploadSellerImageFile(e.target.files[0], 'logo', 'sp-logo-file'));
    document.getElementById('sp-banner-file')?.addEventListener('change', e => uploadSellerImageFile(e.target.files[0], 'banner', 'sp-banner-file'));
    document.getElementById('sp-banner-link')?.addEventListener('input', e => {
        document.getElementById('sp-banner-url').value = e.target.value;
        document.getElementById('sp-banner-preview').src = profileInitialImage({ profile_image: e.target.value });
        document.getElementById('sp-banner-preview').classList.remove('hidden');
        document.getElementById('sp-banner-placeholder').classList.add('hidden');
        updateSellerLivePreview();
    });
    document.getElementById('sp-logo-link')?.addEventListener('input', e => {
        document.getElementById('sp-logo-url').value = e.target.value;
        document.getElementById('sp-logo-preview').src = profileInitialImage({ profile_image: e.target.value });
        updateSellerLivePreview();
    });
    document.getElementById('sp-input-desc')?.addEventListener('input', updateSellerLivePreview);
    const profileInput = document.getElementById('profile-image-file');
    if (profileInput) profileInput.addEventListener('change', e => uploadProfileImageFile(e.target.files[0], profileInput));

    // Cart initialization
    loadOrderListSafely();
    updateCartBadge();

    // Skeletons
    const catCont = document.getElementById('category-container');
    if (catCont) catCont.innerHTML = renderCatSkeleton();
    const prodCont = document.getElementById('products-container');
    if (prodCont) prodCont.innerHTML = renderProdSkeleton(4);
    const featCont = document.getElementById('featured-container');
    if (featCont) featCont.innerHTML = renderProdSkeleton(2, true);
    const discCont = document.getElementById('discount-container');
    if (discCont) discCont.innerHTML = renderProdSkeleton(2, true);
    const nearCont = document.getElementById('nearby-container');
    if (nearCont) nearCont.innerHTML = renderProdSkeleton(2, true);

    initCarousel();
    initTimer();
    switchView('view-home');
    lucide.createIcons();

    initPWA();
    initIdleSessionGuard();
    startAdminDashboardAutoRefresh();

    window.addEventListener('beforeunload', persistCartBeforeNavigation);
    window.addEventListener('pagehide', persistCartBeforeNavigation);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistCartBeforeNavigation();
    });

    // Parallel bootstrap
    const authPromise = checkAuthSession().catch(() => {});
    const configPromise = loadAppConfig().catch(() => {});
    const catalogPromise = loadCatalog().catch(() => {
        showToast("Server utama belum merespons. Menampilkan data lokal.", true);
        try {
            liveCategories = MOCK_CATEGORIES.map(c => ({ id: c.category_id, name: c.category_name, status: c.status }));
            liveProducts = normalizeProducts(MOCK_PRODUCTS);
            sellerCache = {};
            MOCK_SELLERS.forEach(cacheSellerData);
            renderCategories();
            renderProducts(true);
        } catch (fallbackError) {}
    });

    setTimeout(() => loadVideoPromo(), 50);
    setTimeout(() => loadFlashSaleBatches(), 80);

    await Promise.allSettled([authPromise, configPromise]);
    renderHomeHeaderAuth();

    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('active');
        setTimeout(() => { loader.style.display = 'none'; }, 80);
    }
}

document.addEventListener('DOMContentLoaded', initApp);
