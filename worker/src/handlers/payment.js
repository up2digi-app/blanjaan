/**
 * BLANJAAN Worker — Payment Handler
 * createServicePayment, simulateUatPayment, adminMarkUatPaid, getPaymentTransactions
 */

import { supabaseFrom } from '../lib/supabase.js';
import { requireSession, findUserById, getSellerForUser, isAdminUser, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, nowIso } from '../lib/crypto.js';
import { getServicePackages } from './services.js';

export async function handlePayment(action, payload, env) {
  switch (action) {
    case 'createServicePayment':
      return await createServicePayment(env, payload);

    case 'simulateUatPayment':
      return await simulateUatPayment(env, payload);

    case 'adminMarkUatPaid':
      return await adminMarkUatPaid(env, payload);

    case 'getPaymentTransactions':
      return await getPaymentTransactions(env, payload);

    case 'getPaymentClientConfig':
      return { client_key: env.MIDTRANS_CLIENT_KEY || '', is_production: false };

    default:
      throw new Error(`Action payment '${action}' tidak dikenali.`);
  }
}

export async function createServicePayment(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller) throw new Error('Toko aktif diperlukan.');

  const packageId = normalizeText(payload.package_id);
  const packages = await getServicePackages(env);
  const pack = packages.find(p => String(p.package_id) === packageId);
  if (!pack) throw new Error('Paket layanan tidak ditemukan.');

  const paymentId = generateId('PAY');
  const now = nowIso();

  await supabaseFrom(env, 'payment_transactions').insert({
    payment_id: paymentId,
    seller_id: seller.seller_id,
    user_id: session.user_id,
    service_type: normalizeText(pack.service_type || 'TOKEN'),
    package_id: pack.package_id,
    package_name: pack.package_name,
    amount: Number(pack.price || 0),
    payment_status: 'PENDING',
    payment_type: 'uat_dummy',
    created_at: now,
    updated_at: now
  });

  return {
    payment_id: paymentId,
    package_id: pack.package_id,
    package_name: pack.package_name,
    amount: pack.price,
    payment_status: 'PENDING'
  };
}

export async function simulateUatPayment(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const paymentId = normalizeId(payload.payment_id);
  const decision = String(payload.decision || 'PAID').toUpperCase();

  if (!paymentId || !['PAID', 'CANCEL'].includes(decision)) {
    throw new Error('Simulasi pembayaran tidak valid.');
  }

  if (decision === 'PAID') {
    return await applyPaymentPaid(env, paymentId, session.user_id);
  }

  await supabaseFrom(env, 'payment_transactions')
    .eq('payment_id', paymentId)
    .update({ payment_status: 'CANCELLED', updated_at: nowIso() });

  return { payment_id: paymentId, payment_status: 'CANCELLED' };
}

export async function adminMarkUatPaid(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  return await applyPaymentPaid(env, payload.payment_id, session.user_id);
}

export async function getPaymentTransactions(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const rows = await supabaseFrom(env, 'payment_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .execute();

  return rows || [];
}

async function applyPaymentPaid(env, paymentId, adminOrUserId) {
  const rows = await supabaseFrom(env, 'payment_transactions')
    .select('*')
    .eq('payment_id', paymentId)
    .execute();

  if (!rows || !rows.length) throw new Error('Transaksi tidak ditemukan.');
  const pay = rows[0];

  if (pay.payment_status === 'PAID') {
    return { success: true, payment_id: paymentId, payment_status: 'PAID', already_paid: true };
  }

  const packages = await getServicePackages(env);
  const pack = packages.find(p => String(p.package_id) === String(pay.package_id));
  const tokenQty = pack ? Number(pack.token_qty || 0) : 10;
  const days = pack ? Number(pack.duration_days || 90) : 90;

  const now = nowIso();
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  // Mark transaction paid
  await supabaseFrom(env, 'payment_transactions')
    .eq('payment_id', paymentId)
    .update({
      payment_status: 'PAID',
      transaction_status: 'settlement',
      updated_at: now
    });

  // Credit tokens to seller_entitlements
  const entitlementId = generateId('ENT');
  await supabaseFrom(env, 'seller_entitlements').insert({
    entitlement_id: entitlementId,
    seller_id: pay.seller_id,
    user_id: pay.user_id,
    service_type: pay.service_type || 'TOKEN',
    tokens: tokenQty,
    status: 'ACTIVE',
    expires_at: expiresAt,
    created_at: now,
    updated_at: now
  });

  await auditLog(env, adminOrUserId, 'PAYMENT_PAID', 'PAYMENT', paymentId, {
    tokens_credited: tokenQty,
    seller_id: pay.seller_id
  });

  return {
    success: true,
    payment_id: paymentId,
    payment_status: 'PAID',
    token_qty: tokenQty,
    expires_at: expiresAt
  };
}
