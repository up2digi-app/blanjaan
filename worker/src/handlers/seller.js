/**
 * BLANJAAN Worker — Seller Handler
 * submitSeller, upsertProduct, deleteProduct, updateSellerProfile, uploadSellerImage, getSellerOverview, ratings
 */

import { supabaseFrom, supabaseStorageUpload, getConfigValue } from '../lib/supabase.js';
import { requireSession, findUserById, getSellerForUser, isAdminUser, sellerToApi, auditLog } from '../lib/auth.js';
import { productToApi } from './catalog.js';
import {
  generateId,
  normalizeId,
  normalizeText,
  normalizeWhatsApp,
  normalizeVariants,
  nowIso
} from '../lib/crypto.js';

export async function handleSeller(action, payload, env) {
  switch (action) {
    case 'submitSeller':
      return await submitSeller(env, payload);

    case 'upsertProduct':
      return await upsertProduct(env, payload);

    case 'deleteProduct':
      return await deleteProduct(env, payload);

    case 'updateSellerProfile':
      return await updateSellerProfile(env, payload);

    case 'uploadSellerImage':
      return await uploadSellerImage(env, payload);

    case 'getSellerOverview':
      return await getSellerOverview(env, payload);

    case 'submitRating':
      return await submitRating(env, payload);

    case 'getRatings':
      return await getRatings(env, payload);

    case 'getRatingSummary':
      return await getRatingSummary(env, payload);

    default:
      throw new Error(`Action seller '${action}' tidak dikenali.`);
  }
}

export async function submitSeller(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!user) throw new Error('User tidak ditemukan.');
  if (isAdminUser(user)) throw new Error('Akun ADMIN tidak dapat membuka toko.');

  const storeName = normalizeText(payload.store_name);
  const wa = normalizeWhatsApp(payload.wa);
  const category = normalizeText(payload.category);
  const city = normalizeText(payload.city);
  const description = normalizeText(payload.description);

  if (!storeName || !wa || !city) {
    throw new Error('Nama toko, WhatsApp, dan kota wajib diisi.');
  }

  // Check existing application
  const existingApps = await supabaseFrom(env, 'seller_applications')
    .select('application_id,status')
    .eq('user_id', session.user_id)
    .in('status', ['PENDING', 'ACTIVE', 'APPROVED'])
    .execute();

  if (existingApps && existingApps.length) {
    throw new Error('Pengajuan toko Anda sudah ada.');
  }

  // Check existing seller
  const existingSeller = await getSellerForUser(env, session.user_id);
  if (existingSeller) {
    throw new Error('Anda sudah memiliki toko.');
  }

  const applicationId = generateId('APP');
  const now = nowIso();

  await supabaseFrom(env, 'seller_applications').insert({
    application_id: applicationId,
    user_id: session.user_id,
    store_name: storeName,
    wa,
    category,
    city,
    description,
    status: 'PENDING',
    created_at: now,
    updated_at: now
  });

  await auditLog(env, session.user_id, 'SUBMIT_SELLER_APPLICATION', 'SELLER_APPLICATION', applicationId, {
    store_name: storeName
  });

  return { application_id: applicationId, status: 'PENDING' };
}

export async function upsertProduct(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') {
    throw new Error('Toko aktif diperlukan.');
  }

  const productId = normalizeId(payload.product_id);
  const categoryId = normalizeId(payload.category_id);
  const productCategory = normalizeText(payload.product_category);
  const productName = normalizeText(payload.product_name);
  const price = Math.max(0, Number(payload.price || 0));
  const promoPrice = Math.max(0, Number(payload.promo_price || 0));
  const stock = Math.max(0, Number(payload.stock || 0));
  const image = normalizeText(payload.main_image);
  const description = normalizeText(payload.description);
  const specification = normalizeText(payload.specification);

  let variants = payload.variants;
  if (typeof variants === 'string') {
    try { variants = JSON.parse(variants); } catch (_) { variants = []; }
  }
  if (!Array.isArray(variants)) variants = [];

  if (!productName || price <= 0) {
    throw new Error('Nama produk dan harga wajib diisi.');
  }
  if (promoPrice > 0 && promoPrice >= price) {
    throw new Error('Harga promo harus lebih rendah dari harga normal.');
  }

  const now = nowIso();

  if (productId) {
    const existing = await supabaseFrom(env, 'products')
      .select('product_id,seller_id')
      .eq('product_id', productId)
      .execute();

    if (!existing || !existing.length || normalizeId(existing[0].seller_id) !== normalizeId(seller.seller_id)) {
      throw new Error('Produk tidak ditemukan atau bukan milik toko Anda.');
    }

    const fields = {
      category_id: categoryId,
      product_category: productCategory,
      product_name: productName,
      price,
      promo_price: promoPrice,
      main_image: image,
      description,
      specification,
      variants: normalizeVariants(variants),
      stock,
      status: 'ACTIVE',
      updated_at: now
    };

    await supabaseFrom(env, 'products')
      .eq('product_id', productId)
      .update(fields);

    await auditLog(env, session.user_id, 'UPDATE_PRODUCT', 'PRODUCT', productId, { product_name: productName });

    return { product_id: productId, saved: true, status: 'ACTIVE' };
  }

  // Check free active product limit
  const freeLimitStr = await getConfigValue(env, 'FREE_ACTIVE_PRODUCTS', '3');
  const freeLimit = Number(freeLimitStr || 3);

  const activeProducts = await supabaseFrom(env, 'products')
    .select('product_id')
    .eq('seller_id', seller.seller_id)
    .eq('status', 'ACTIVE')
    .execute();

  const activeCount = (activeProducts || []).length;
  if (activeCount >= freeLimit) {
    throw new Error(`Batas produk aktif Free adalah ${freeLimit} produk. Upgrade paket untuk menambah kapasitas.`);
  }

  const newProductId = generateId('P');

  await supabaseFrom(env, 'products').insert({
    product_id: newProductId,
    seller_id: seller.seller_id,
    category_id: categoryId,
    product_category: productCategory,
    product_name: productName,
    price,
    promo_price: promoPrice,
    main_image: image,
    description,
    specification,
    stock,
    views: 0,
    featured: false,
    status: 'ACTIVE',
    upload_date: now,
    variants: normalizeVariants(variants),
    created_at: now,
    updated_at: now
  });

  await auditLog(env, session.user_id, 'CREATE_PRODUCT', 'PRODUCT', newProductId, { product_name: productName });

  return { product_id: newProductId, saved: true, status: 'ACTIVE' };
}

export async function deleteProduct(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') {
    throw new Error('Toko aktif diperlukan.');
  }

  const productId = normalizeId(payload.product_id);
  const rows = await supabaseFrom(env, 'products')
    .select('product_id,seller_id')
    .eq('product_id', productId)
    .execute();

  if (!rows || !rows.length || normalizeId(rows[0].seller_id) !== normalizeId(seller.seller_id)) {
    throw new Error('Produk tidak ditemukan.');
  }

  const now = nowIso();
  await supabaseFrom(env, 'products')
    .eq('product_id', productId)
    .update({
      status: 'DELETED',
      updated_at: now
    });

  await auditLog(env, session.user_id, 'DELETE_PRODUCT', 'PRODUCT', productId, {});

  return { deleted: true, product_id: productId };
}

export async function updateSellerProfile(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') {
    throw new Error('Toko aktif diperlukan.');
  }

  const fields = {
    logo: normalizeText(payload.logo),
    banner: normalizeText(payload.banner),
    description: normalizeText(payload.description),
    updated_at: nowIso()
  };

  await supabaseFrom(env, 'sellers')
    .eq('seller_id', seller.seller_id)
    .update(fields);

  await auditLog(env, session.user_id, 'UPDATE_SELLER_PROFILE', 'SELLER', seller.seller_id, fields);

  return { seller: sellerToApi({ ...seller, ...fields }) };
}

export async function uploadSellerImage(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') {
    throw new Error('Toko aktif diperlukan.');
  }

  const field = String(payload.field || '').toLowerCase();
  if (!['logo', 'banner'].includes(field)) {
    throw new Error('Field gambar toko tidak valid.');
  }

  const data = String(payload.data_base64 || '').trim();
  const mime = String(payload.mime_type || 'image/jpeg').trim();

  if (!data) throw new Error('File gambar tidak ditemukan.');
  if (data.length > 6 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar. Maksimal 4 MB.');

  let url = '';
  try {
    const rawBinary = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const filename = `seller_${field}_${seller.seller_id}_${Date.now()}.jpg`;
    url = await supabaseStorageUpload(env, 'blanjaan-media', `sellers/${filename}`, rawBinary, mime);
  } catch (err) {
    if (payload.image_url) {
      url = payload.image_url;
    } else {
      url = `data:${mime};base64,${data}`;
    }
  }

  const updateObj = { [field]: url, updated_at: nowIso() };
  await supabaseFrom(env, 'sellers')
    .eq('seller_id', seller.seller_id)
    .update(updateObj);

  await auditLog(env, session.user_id, 'UPLOAD_SELLER_IMAGE', 'SELLER', seller.seller_id, { field, url });

  const fresh = await getSellerForUser(env, session.user_id);
  return { field, url, seller: fresh };
}

export async function getSellerOverview(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller) throw new Error('Toko tidak ditemukan.');

  const [services, serviceApps, products] = await Promise.all([
    supabaseFrom(env, 'seller_entitlements')
      .select('*')
      .eq('seller_id', seller.seller_id)
      .execute()
      .catch(() => []),
    supabaseFrom(env, 'service_applications')
      .select('*')
      .eq('seller_id', seller.seller_id)
      .execute()
      .catch(() => []),
    supabaseFrom(env, 'products')
      .select('*')
      .eq('seller_id', seller.seller_id)
      .neq('status', 'DELETED')
      .execute()
      .catch(() => [])
  ]);

  return {
    seller,
    services: services || [],
    flash_details: [],
    service_applications: serviceApps || [],
    promotion_applications: [],
    stats: {
      total_products: (products || []).length,
      active_products: (products || []).filter(p => p.status === 'ACTIVE').length,
      service_programs: (services || []).filter(s => ['ACTIVE', 'APPROVED', 'PAID'].includes(String(s.status).toUpperCase())).length
    }
  };
}

export async function submitRating(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const sellerId = normalizeText(payload.seller_id);
  const stars = Number(payload.stars || 0);
  const review = normalizeText(payload.review);

  if (!sellerId) throw new Error('Seller ID wajib diisi.');
  if (stars < 1 || stars > 5) throw new Error('Rating harus 1-5.');

  const ratingId = generateId('RAT');
  const now = nowIso();

  await supabaseFrom(env, 'ratings').insert({
    rating_id: ratingId,
    seller_id: sellerId,
    user_id: session.user_id,
    order_id: normalizeId(payload.order_id),
    rating: stars,
    review,
    created_at: now
  });

  return { rating_id: ratingId, saved: true };
}

export async function getRatings(env, payload = {}) {
  const sellerId = normalizeText(payload.seller_id);
  if (!sellerId) return [];

  const rows = await supabaseFrom(env, 'ratings')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .execute();

  return rows || [];
}

export async function getRatingSummary(env, payload = {}) {
  const sellerId = normalizeText(payload.seller_id);
  if (!sellerId) return { average: 0, count: 0 };

  const rows = await supabaseFrom(env, 'ratings')
    .select('rating')
    .eq('seller_id', sellerId)
    .execute();

  if (!rows || !rows.length) return { average: 0, count: 0 };

  const total = rows.reduce((sum, r) => sum + Number(r.rating || 0), 0);
  return {
    average: Number((total / rows.length).toFixed(1)),
    count: rows.length
  };
}
