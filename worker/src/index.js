/**
 * BLANJAAN Cloudflare Worker — Main Entry Point
 * Routing, CORS, and unified API response formatting
 */

import { handleCatalog } from './handlers/catalog.js';
import { handleAuth } from './handlers/auth.js';
import { handleUser } from './handlers/user.js';
import { handleSeller } from './handlers/seller.js';
import { handleOrders } from './handlers/orders.js';
import { handleFlash } from './handlers/flash.js';
import { handleServices } from './handlers/services.js';
import { handleBanners } from './handlers/banners.js';
import { handleAdmin } from './handlers/admin.js';
import { handlePayment } from './handlers/payment.js';
import { nowIso } from './lib/crypto.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, ''); // trim trailing slashes

      // Extract action: from pathname (/api/:action) or query param (?action=...)
      let action = '';
      if (pathname.startsWith('/api/')) {
        action = pathname.substring(5);
      } else if (pathname === '/api') {
        action = url.searchParams.get('action') || '';
      } else if (pathname === '/health' || pathname === '') {
        action = 'health';
      }

      // Collect payload from query params
      let payload = {};
      url.searchParams.forEach((val, key) => {
        if (key !== 'action') {
          payload[key] = val;
        }
      });

      // Parse request body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
        const contentType = request.headers.get('content-type') || '';
        const bodyText = await request.text();

        if (bodyText.trim()) {
          try {
            const parsed = JSON.parse(bodyText);
            if (parsed && typeof parsed === 'object') {
              payload = { ...payload, ...parsed };
            }
          } catch (_) {
            // If body is form-urlencoded or plain string
            try {
              const params = new URLSearchParams(bodyText);
              params.forEach((v, k) => { payload[k] = v; });
            } catch (_) {}
          }
        }
      }

      if (!action) {
        action = payload.action || 'health';
      }
      delete payload.action;

      // Execute route
      const result = await routeAction(action, payload, env);
      return jsonSuccess(result);
    } catch (err) {
      console.error('[Worker API Error]', err);
      return jsonError(err);
    }
  }
};

async function routeAction(action, payload, env) {
  // 1. Health check
  if (action === 'health') {
    return {
      status: 'ok',
      app: 'BLANJAAN',
      version: '2.0.0',
      timestamp: nowIso(),
      runtime: 'Cloudflare Worker'
    };
  }

  // 2. Catalog
  const catalogActions = [
    'config', 'appConfig', 'categories', 'products', 'sellerProducts',
    'catalog', 'seller', 'sellers', 'hero', 'banners', 'videos',
    'videoPromo', 'media', 'assets', 'recordProductView', 'urls'
  ];
  if (catalogActions.includes(action)) {
    return await handleCatalog(action, payload, env);
  }

  // 3. Auth
  const authActions = [
    'authCheckLoginMethod', 'authRequestOtp', 'authVerifyOtp',
    'authLoginPassword', 'authMe', 'authValidateSession', 'authLogout'
  ];
  if (authActions.includes(action)) {
    return await handleAuth(action, payload, env);
  }

  // 4. User
  const userActions = [
    'updateMyProfile', 'setPassword', 'requestPasswordReset',
    'verifyPasswordResetOtp', 'uploadProfileImage'
  ];
  if (userActions.includes(action)) {
    return await handleUser(action, payload, env);
  }

  // 5. Seller
  const sellerActions = [
    'submitSeller', 'upsertProduct', 'deleteProduct', 'updateSellerProfile',
    'uploadSellerImage', 'getSellerOverview', 'submitRating', 'getRatings', 'getRatingSummary'
  ];
  if (sellerActions.includes(action)) {
    return await handleSeller(action, payload, env);
  }

  // 6. Orders
  const orderActions = [
    'createOrder', 'markOrderWhatsappOpened', 'getMyOrders', 'saveCart', 'getMyCart'
  ];
  if (orderActions.includes(action)) {
    return await handleOrders(action, payload, env);
  }

  // 7. Flash Sale
  const flashActions = [
    'getFlashSaleBatches', 'createFlashSaleBatch', 'updateFlashSaleBatch',
    'deleteFlashSaleBatch', 'submitFlashSaleApplication', 'getFlashSaleApplications',
    'getFlashSaleSellerOptions', 'reviewFlashSaleApplication'
  ];
  if (flashActions.includes(action)) {
    return await handleFlash(action, payload, env);
  }

  // 8. Services & Tokens
  const serviceActions = [
    'getServicePackages', 'getSellerEntitlements', 'applySellerService', 'reviewServiceApplication'
  ];
  if (serviceActions.includes(action)) {
    return await handleServices(action, payload, env);
  }

  // 9. Hero Banners CRUD (Fase 3)
  const bannerActions = [
    'getBanners', 'adminGetBanners', 'createBanner', 'updateBanner', 'deleteBanner'
  ];
  if (bannerActions.includes(action)) {
    return await handleBanners(action, payload, env);
  }

  // 10. Admin
  const adminActions = [
    'getAdminDashboard', 'getSellerApplications', 'reviewSellerApplication',
    'setAdminRole', 'getTokenTarif', 'setTokenTarif'
  ];
  if (adminActions.includes(action)) {
    return await handleAdmin(action, payload, env);
  }

  // 11. Payment
  const paymentActions = [
    'createServicePayment', 'simulateUatPayment', 'adminMarkUatPaid',
    'getPaymentTransactions', 'getPaymentClientConfig'
  ];
  if (paymentActions.includes(action)) {
    return await handlePayment(action, payload, env);
  }

  throw new Error(`Action tidak valid/diizinkan: ${action}`);
}

function jsonSuccess(data) {
  return new Response(
    JSON.stringify({
      success: true,
      data
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json;charset=utf-8'
      }
    }
  );
}

function jsonError(err) {
  const message = err && err.message ? err.message : String(err);
  return new Response(
    JSON.stringify({
      success: false,
      message,
      data: null
    }),
    {
      status: 200, // Return 200 with success: false consistent with frontend expectation
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json;charset=utf-8'
      }
    }
  );
}
