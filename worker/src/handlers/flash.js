/**
 * BLANJAAN Worker — Flash Sale Handler
 * Batches, applications, seller options, review
 */

import { supabaseFrom } from '../lib/supabase.js';
import { requireSession, findUserById, getSellerForUser, isAdminUser, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, nowIso } from '../lib/crypto.js';

export async function handleFlash(action, payload, env) {
  switch (action) {
    case 'getFlashSaleBatches':
      return await getFlashSaleBatches(env);

    case 'createFlashSaleBatch':
      return await createFlashSaleBatch(env, payload);

    case 'updateFlashSaleBatch':
      return await updateFlashSaleBatch(env, payload);

    case 'deleteFlashSaleBatch':
      return await deleteFlashSaleBatch(env, payload);

    case 'submitFlashSaleApplication':
      return await submitFlashSaleApplication(env, payload);

    case 'getFlashSaleApplications':
      return await getFlashSaleApplications(env, payload);

    case 'getFlashSaleSellerOptions':
      return await getFlashSaleSellerOptions(env, payload);

    case 'reviewFlashSaleApplication':
      return await reviewFlashSaleApplication(env, payload);

    default:
      throw new Error(`Action flash '${action}' tidak dikenali.`);
  }
}

export async function getFlashSaleBatches(env) {
  const rows = await supabaseFrom(env, 'flash_sale_batches')
    .select('*')
    .eq('active', true)
    .order('start_at', { ascending: true })
    .execute();

  return (rows || []).map(r => ({
    batch_id: normalizeId(r.batch_id),
    name: normalizeText(r.name),
    start_at: r.start_at,
    end_at: r.end_at,
    status: normalizeText(r.status || 'ACTIVE').toUpperCase(),
    quota: Number(r.quota || 0),
    token_cost: Number(r.token_cost || 1),
    active: r.active === true
  }));
}

export async function createFlashSaleBatch(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const name = normalizeText(payload.name);
  const startAt = payload.start_at;
  const endAt = payload.end_at;
  const quota = Math.max(1, Number(payload.quota || 20));

  if (!name || !startAt || !endAt) {
    throw new Error('Nama, waktu mulai, dan waktu selesai batch wajib diisi.');
  }

  const batchId = generateId('BAT');
  const now = nowIso();

  await supabaseFrom(env, 'flash_sale_batches').insert({
    batch_id: batchId,
    name,
    start_at: startAt,
    end_at: endAt,
    status: 'ACTIVE',
    quota,
    token_cost: Number(payload.token_cost || 1),
    active: true,
    created_at: now,
    updated_at: now
  });

  await auditLog(env, session.user_id, 'CREATE_FLASH_SALE_BATCH', 'FLASH_BATCH', batchId, { name });

  return { batch_id: batchId, saved: true };
}

export async function updateFlashSaleBatch(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const batchId = normalizeId(payload.batch_id);
  if (!batchId) throw new Error('batch_id wajib diisi.');

  const fields = {
    updated_at: nowIso()
  };

  if (payload.name) fields.name = normalizeText(payload.name);
  if (payload.start_at) fields.start_at = payload.start_at;
  if (payload.end_at) fields.end_at = payload.end_at;
  if (payload.quota !== undefined) fields.quota = Number(payload.quota);
  if (payload.status) fields.status = normalizeText(payload.status).toUpperCase();
  if (payload.active !== undefined) fields.active = payload.active === true;

  await supabaseFrom(env, 'flash_sale_batches')
    .eq('batch_id', batchId)
    .update(fields);

  return { batch_id: batchId, updated: true };
}

export async function deleteFlashSaleBatch(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const batchId = normalizeId(payload.batch_id);
  await supabaseFrom(env, 'flash_sale_batches')
    .eq('batch_id', batchId)
    .update({ active: false, status: 'CANCELLED', updated_at: nowIso() });

  return { batch_id: batchId, deleted: true };
}

export async function submitFlashSaleApplication(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') throw new Error('Toko aktif diperlukan.');

  const batchId = normalizeId(payload.batch_id);
  const productId = normalizeId(payload.product_id);
  const promoPrice = Number(payload.promo_price || 0);

  if (!batchId || !productId || promoPrice <= 0) {
    throw new Error('Batch, produk, dan harga promo wajib diisi.');
  }

  const prod = await supabaseFrom(env, 'products')
    .select('product_id,seller_id,price')
    .eq('product_id', productId)
    .execute();

  if (!prod || !prod.length || normalizeId(prod[0].seller_id) !== normalizeId(seller.seller_id)) {
    throw new Error('Produk tidak ditemukan atau bukan milik toko Anda.');
  }

  const requestId = generateId('FSR');
  const now = nowIso();

  await supabaseFrom(env, 'flash_sale_applications').insert({
    application_id: requestId,
    batch_id: batchId,
    seller_id: seller.seller_id,
    product_id: productId,
    promo_price: promoPrice,
    promo_stock: Number(payload.promo_stock || 10),
    status: 'PENDING_ADMIN',
    created_at: now,
    updated_at: now
  });

  return { request_id: requestId, status: 'PENDING_ADMIN' };
}

export async function getFlashSaleApplications(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const rows = await supabaseFrom(env, 'flash_sale_applications')
    .select('*')
    .order('created_at', { ascending: false })
    .execute();

  return rows || [];
}

export async function getFlashSaleSellerOptions(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller) throw new Error('Toko tidak ditemukan.');

  const [batches, products] = await Promise.all([
    getFlashSaleBatches(env),
    supabaseFrom(env, 'products')
      .select('product_id,product_name,price,main_image,stock')
      .eq('seller_id', seller.seller_id)
      .eq('status', 'ACTIVE')
      .execute()
  ]);

  return {
    batches: (batches || []).filter(b => new Date(b.end_at).getTime() > Date.now()),
    products: products || []
  };
}

export async function reviewFlashSaleApplication(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const requestId = normalizeId(payload.request_id || payload.application_id);
  const decision = normalizeText(payload.decision).toUpperCase();

  if (!requestId || !['APPROVE', 'REJECT'].includes(decision)) {
    throw new Error('Keputusan tidak valid.');
  }

  const now = nowIso();
  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  await supabaseFrom(env, 'flash_sale_applications')
    .eq('application_id', requestId)
    .update({
      status,
      reviewed_at: now,
      reviewed_by: session.user_id,
      rejection_reason: decision === 'REJECT' ? (normalizeText(payload.reason) || 'Ditolak admin') : '',
      updated_at: now
    });

  return { application_id: requestId, status };
}
