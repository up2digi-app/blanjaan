/**
 * BLANJAAN Worker — Catalog Handler
 * config, categories, products, sellers, banners, videos, product views
 */

import { supabaseFrom, getConfigValue } from '../lib/supabase.js';
import { normalizeId, normalizeText, toBool, parseVariants } from '../lib/crypto.js';

export async function handleCatalog(action, payload, env) {
  switch (action) {
    case 'config':
    case 'appConfig':
      return await getConfig(env);

    case 'categories':
      return await getCategories(env);

    case 'products':
      return await getProducts(env, payload);

    case 'sellerProducts':
      return await getProducts(env, { ...payload, limit: payload.limit || 500, fresh: true });

    case 'catalog':
      return await getCatalog(env, payload);

    case 'seller':
      return await getSeller(env, payload);

    case 'sellers':
      return await getSellers(env, payload);

    case 'hero':
    case 'banners':
      return await getHeroBanners(env);

    case 'videos':
    case 'videoPromo':
      return await getVideos(env);

    case 'media':
    case 'assets':
      return await getAssets(env);

    case 'recordProductView':
      return await recordProductView(env, payload);

    case 'urls':
      return [];

    default:
      throw new Error(`Action catalog '${action}' tidak dikenali.`);
  }
}

export async function getConfig(env) {
  try {
    const rows = await supabaseFrom(env, 'app_config')
      .select('config_key,config_value,active')
      .eq('active', true)
      .execute();

    const conf = {};
    (rows || []).forEach(r => {
      if (toBool(r.active)) {
        conf[r.config_key] = r.config_value;
      }
    });

    if (!conf.BRAND_NAME) conf.BRAND_NAME = 'BLANJAAN';
    if (!conf.BRAND_URL && conf.WA_BRAND_URL) conf.BRAND_URL = conf.WA_BRAND_URL;
    if (!conf.WA_BRAND_URL && conf.BRAND_URL) conf.WA_BRAND_URL = conf.BRAND_URL;
    if (!conf.BRAND_MESSAGE_FOOTER && conf.WA_BRAND_FOOTER) conf.BRAND_MESSAGE_FOOTER = conf.WA_BRAND_FOOTER;
    if (!conf.WA_BRAND_FOOTER && conf.BRAND_MESSAGE_FOOTER) conf.WA_BRAND_FOOTER = conf.BRAND_MESSAGE_FOOTER;
    if (!conf.FREE_ACTIVE_PRODUCTS) conf.FREE_ACTIVE_PRODUCTS = '3';

    return conf;
  } catch (err) {
    return {
      BRAND_NAME: 'BLANJAAN',
      BRAND_URL: 'https://blanjaan.up2digital.workers.dev',
      BRAND_MESSAGE_FOOTER: 'Pesanan melalui BLANJAAN',
      WA_BRAND_FOOTER: 'Pesanan melalui BLANJAAN',
      WA_BRAND_URL: 'https://blanjaan.up2digital.workers.dev',
      FREE_ACTIVE_PRODUCTS: '3'
    };
  }
}

export async function getCategories(env) {
  const rows = await supabaseFrom(env, 'categories')
    .select('*')
    .eq('status', 'ACTIVE')
    .order('sort_order', { ascending: true })
    .execute();

  return (rows || []).map(r => ({
    category_id: normalizeId(r.category_id),
    category_name: normalizeText(r.category_name),
    icon: normalizeText(r.icon),
    status: normalizeText(r.status || 'ACTIVE').toUpperCase(),
    image_url: normalizeText(r.image_url),
    sort_order: Number(r.sort_order || 0)
  }));
}

export async function getProducts(env, payload = {}) {
  let query = supabaseFrom(env, 'products')
    .select('*')
    .eq('status', 'ACTIVE');

  const sellerId = normalizeId(payload.seller_id);
  const categoryId = normalizeId(payload.category_id);
  const categoryName = normalizeText(payload.category_name);
  const search = normalizeText(payload.search);

  if (sellerId) query = query.eq('seller_id', sellerId);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (categoryName) query = query.ilike('product_category', categoryName);
  if (search) query = query.ilike('product_name', `%${search}%`);

  query = query.order('upload_date', { ascending: false });

  const limit = Math.max(1, Math.min(Number(payload.limit || 100), 500));
  const offset = Math.max(0, Number(payload.offset || 0));
  query = query.range(offset, offset + limit - 1);

  const rows = await query.execute();
  return (rows || []).map(productToApi);
}

export async function getCatalog(env, payload = {}) {
  const [categories, products, sellers] = await Promise.all([
    getCategories(env),
    getProducts(env, payload),
    getSellers(env, {})
  ]);

  return {
    categories,
    products,
    sellers
  };
}

export async function getSeller(env, payload = {}) {
  const id = normalizeId(payload.id || payload.seller_id);
  if (!id) return await getSellers(env, {});

  const rows = await supabaseFrom(env, 'sellers')
    .select('*')
    .eq('seller_id', id)
    .execute();

  if (rows && rows.length) return sellerToApi(rows[0]);

  // Try lookup by application_id
  const appRows = await supabaseFrom(env, 'sellers')
    .select('*')
    .eq('application_id', id)
    .execute();

  if (appRows && appRows.length) return sellerToApi(appRows[0]);
  return [];
}

export async function getSellers(env, payload = {}) {
  let query = supabaseFrom(env, 'sellers')
    .select('*')
    .eq('status', 'ACTIVE');

  const city = normalizeText(payload.city);
  if (city) {
    query = query.ilike('city', city);
  }

  const rows = await query.execute();
  return (rows || []).map(sellerToApi);
}

export async function getHeroBanners(env) {
  try {
    const rows = await supabaseFrom(env, 'media')
      .select('*')
      .eq('usage', 'HERO')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .execute();

    return (rows || []).map(r => ({
      banner_id: normalizeId(r.entity_id || r.asset_id),
      image_url: normalizeText(r.url),
      title_html: normalizeText(r.title),
      subtitle: normalizeText(r.subtitle),
      active: toBool(r.active),
      sort_order: Number(r.sort_order || 0),
      created_at: r.created_at,
      updated_at: r.updated_at
    }));
  } catch (_) {
    return [];
  }
}

export async function getVideos(env) {
  try {
    const rows = await supabaseFrom(env, 'media')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .execute();

    const filtered = (rows || []).filter(r => {
      const url = normalizeText(r.url);
      if (!url) return false;
      const usage = normalizeText(r.usage).toUpperCase().replace(/[\s-]+/g, '_');
      const type = normalizeText(r.asset_type).toLowerCase();
      return usage === 'BLANJAAN_PLAY' || usage === 'BLANJAANPLAY' || type === 'video' ||
        /youtube\.com|youtu\.be|tiktok\.com|drive\.google\.com|\.mp4($|\?)/i.test(url);
    });

    return filtered.map(r => {
      const url = normalizeText(r.url);
      return {
        video_id: normalizeId(r.entity_id || r.asset_id),
        video_url: url,
        title: normalizeText(r.title),
        store_name: normalizeText(r.store_name),
        active: true,
        sort_order: Number(r.sort_order || 0),
        thumbnail_url: normalizeText(r.thumbnail_url) || getVideoThumbnail(url)
      };
    });
  } catch (_) {
    return [];
  }
}

export async function getAssets(env) {
  const rows = await supabaseFrom(env, 'media')
    .select('*')
    .eq('active', true)
    .execute();
  return rows || [];
}

export async function recordProductView(env, payload = {}) {
  const productId = normalizeId(payload.product_id);
  if (!productId) throw new Error('product_id wajib diisi.');

  const rows = await supabaseFrom(env, 'products')
    .select('product_id,views,status')
    .eq('product_id', productId)
    .execute();

  if (!rows || !rows.length || rows[0].status !== 'ACTIVE') {
    throw new Error('Produk tidak ditemukan.');
  }

  const currentViews = Math.max(0, Number(rows[0].views || 0));
  const nextViews = currentViews + 1;

  await supabaseFrom(env, 'products')
    .eq('product_id', productId)
    .update({ views: nextViews, updated_at: new Date().toISOString() });

  return { product_id: productId, views: nextViews };
}

/* Helpers */
export function productToApi(r) {
  return {
    product_id: normalizeId(r.product_id),
    seller_id: normalizeId(r.seller_id),
    category_id: normalizeId(r.category_id),
    product_category: normalizeText(r.product_category),
    product_name: normalizeText(r.product_name),
    price: Number(r.price || 0),
    promo_price: Number(r.promo_price || 0),
    main_image: normalizeText(r.main_image),
    description: normalizeText(r.description),
    specification: normalizeText(r.specification),
    stock: r.stock !== undefined && r.stock !== null ? Number(r.stock) : 0,
    views: Number(r.views || 0),
    featured: toBool(r.featured),
    status: normalizeText(r.status || 'ACTIVE').toUpperCase(),
    upload_date: r.upload_date || r.created_at || new Date(0).toISOString(),
    variants: parseVariants(r.variants),
    flash_sale_status: normalizeText(r.flash_sale_status).toUpperCase(),
    flash_sale_batch_id: normalizeText(r.flash_sale_batch_id),
    flash_sale_requested_start: r.flash_sale_requested_start || '',
    flash_sale_requested_end: r.flash_sale_requested_end || '',
    flash_sale_price: Number(r.flash_sale_price || 0),
    flash_sale_payment_status: normalizeText(r.flash_sale_payment_status).toUpperCase(),
    flash_sale_windows: []
  };
}

export function sellerToApi(r) {
  return {
    seller_id: normalizeId(r.seller_id),
    owner_user_id: normalizeId(r.owner_user_id),
    store_name: normalizeText(r.store_name),
    city: normalizeText(r.city),
    district: normalizeText(r.district),
    wa: normalizeText(r.wa),
    website: normalizeText(r.website),
    logo: normalizeText(r.logo),
    banner: normalizeText(r.banner),
    description: normalizeText(r.description),
    category: normalizeText(r.category),
    status: normalizeText(r.status || 'ACTIVE').toUpperCase()
  };
}

function getVideoThumbnail(url) {
  const u = normalizeText(url);
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^?&/]+)/i);
  if (yt && yt[1]) return `https://img.youtube.com/vi/${encodeURIComponent(yt[1])}/hqdefault.jpg`;

  const drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([A-Za-z0-9_-]+)/i);
  if (drive && drive[1]) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(drive[1])}&sz=w600`;

  return '';
}
