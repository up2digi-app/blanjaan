/**
 * BLANJAAN Worker — Services & Token Entitlements Handler
 * Packages, entitlements, applications + Token Auto-Deduction (Fase 3)
 */

import { supabaseFrom, getConfigValue } from '../lib/supabase.js';
import { requireSession, findUserById, getSellerForUser, isAdminUser, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, nowIso } from '../lib/crypto.js';

export async function handleServices(action, payload, env) {
  switch (action) {
    case 'getServicePackages':
      return await getServicePackages(env);

    case 'getSellerEntitlements':
      return await getSellerEntitlements(env, payload);

    case 'applySellerService':
      return await applySellerService(env, payload);

    case 'reviewServiceApplication':
      return await reviewServiceApplication(env, payload);

    default:
      throw new Error(`Action services '${action}' tidak dikenali.`);
  }
}

export async function getServicePackages(env) {
  const rows = await supabaseFrom(env, 'service_packages')
    .select('*')
    .order('price', { ascending: true })
    .execute();

  if (rows && rows.length) return rows;

  // Fallback defaults
  return [
    { package_id: 'PKG_TOKEN_10', package_name: 'Paket 10 Token', price: 50000, token_qty: 10, duration_days: 90, description: '10 Token untuk Kejar Diskon, BlanjaanPlay & Promosi' },
    { package_id: 'PKG_TOKEN_25', package_name: 'Paket 25 Token', price: 100000, token_qty: 25, duration_days: 90, description: '25 Token hemat untuk toko bertumbuh' },
    { package_id: 'PKG_TOKEN_60', package_name: 'Paket 60 Token Super', price: 200000, token_qty: 60, duration_days: 180, description: '60 Token untuk promosi maksimal' }
  ];
}

export async function getSellerEntitlements(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller) return [];

  const rows = await supabaseFrom(env, 'seller_entitlements')
    .select('*')
    .eq('seller_id', seller.seller_id)
    .execute();

  return rows || [];
}

/**
 * Fase 3: applySellerService with Token Auto-Deduction
 */
export async function applySellerService(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const seller = await getSellerForUser(env, session.user_id);
  if (!seller || seller.status !== 'ACTIVE') throw new Error('Toko aktif diperlukan.');

  const type = String(payload.service_type || '').toUpperCase();
  const validTypes = ['UMKM_TERPERCAYA', 'UMKM_PILIHAN', 'BLANJAAN_PLAY', 'IKLAN_BANNER'];
  if (!validTypes.includes(type)) {
    throw new Error('Program layanan tidak valid.');
  }

  // Token cost mapping from app_config (Fase 3)
  const tokenCostKeyMap = {
    'BLANJAAN_PLAY': 'TOKEN_COST_BLANJAAN_PLAY',
    'UMKM_PILIHAN': 'TOKEN_COST_UMKM_PILIHAN',
    'IKLAN_BANNER': 'TOKEN_COST_IKLAN_BANNER'
  };

  const defaultCosts = {
    'BLANJAAN_PLAY': 1,
    'UMKM_PILIHAN': 2,
    'IKLAN_BANNER': 3
  };

  const requiredTokens = tokenCostKeyMap[type]
    ? Number(await getConfigValue(env, tokenCostKeyMap[type], String(defaultCosts[type])))
    : 0;

  const now = nowIso();
  const id = generateId('SVA');
  const notes = normalizeText(payload.notes);

  if (type === 'UMKM_TERPERCAYA') {
    if (!notes) throw new Error('Link dokumen / catatan verifikasi wajib diisi untuk UMKM Terpercaya.');

    await supabaseFrom(env, 'service_applications').insert({
      application_id: id,
      seller_id: seller.seller_id,
      user_id: session.user_id,
      service_type: type,
      package_name: 'UMKM Terpercaya',
      amount: 0,
      payment_status: 'FREE',
      status: 'PENDING',
      notes,
      created_at: now,
      updated_at: now
    });

    await auditLog(env, session.user_id, 'APPLY_SERVICE', 'SERVICE_APPLICATION', id, { service_type: type });
    return { application_id: id, status: 'PENDING' };
  }

  // Auto-deduct tokens for programs requiring tokens
  if (requiredTokens > 0) {
    const entitlements = await supabaseFrom(env, 'seller_entitlements')
      .select('*')
      .eq('seller_id', seller.seller_id)
      .eq('status', 'ACTIVE')
      .execute();

    let totalAvailable = 0;
    (entitlements || []).forEach(e => {
      totalAvailable += Number(e.tokens || 0);
    });

    if (totalAvailable < requiredTokens) {
      throw new Error(`Token tidak mencukupi. Dibutuhkan ${requiredTokens} token, saldo Anda ${totalAvailable} token. Silakan beli paket token terlebih dahulu.`);
    }

    // Deduct tokens
    let needed = requiredTokens;
    for (const ent of (entitlements || [])) {
      const cur = Number(ent.tokens || 0);
      if (cur <= 0) continue;
      const take = Math.min(cur, needed);
      const remaining = cur - take;

      await supabaseFrom(env, 'seller_entitlements')
        .eq('entitlement_id', ent.entitlement_id)
        .update({
          tokens: remaining,
          updated_at: now
        });

      needed -= take;
      if (needed <= 0) break;
    }

    // Direct activation because token deduction succeeded
    await supabaseFrom(env, 'service_applications').insert({
      application_id: id,
      seller_id: seller.seller_id,
      user_id: session.user_id,
      service_type: type,
      package_name: getServiceTitle(type),
      amount: requiredTokens,
      payment_status: 'PAID',
      status: 'ACTIVE',
      notes,
      created_at: now,
      updated_at: now
    });

    await auditLog(env, session.user_id, 'APPLY_SERVICE_AUTO_TOKEN', 'SERVICE_APPLICATION', id, {
      service_type: type,
      tokens_deducted: requiredTokens
    });

    return {
      application_id: id,
      status: 'ACTIVE',
      tokens_deducted: requiredTokens,
      message: `Berhasil diaktifkan dengan pemotongan ${requiredTokens} token.`
    };
  }

  throw new Error('Konfigurasi program tidak valid.');
}

export async function reviewServiceApplication(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const id = normalizeId(payload.application_id);
  const decision = String(payload.decision || '').toUpperCase();
  if (!id || !['APPROVE', 'REJECT'].includes(decision)) {
    throw new Error('Data approval tidak valid.');
  }

  const now = nowIso();
  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  await supabaseFrom(env, 'service_applications')
    .eq('application_id', id)
    .update({
      status,
      reviewed_at: now,
      reviewed_by: session.user_id,
      rejection_reason: decision === 'REJECT' ? (normalizeText(payload.reason) || 'Ditolak admin') : '',
      updated_at: now
    });

  await auditLog(env, session.user_id, 'REVIEW_SERVICE_APPLICATION', 'SERVICE_APPLICATION', id, { decision });

  return { application_id: id, status };
}

function getServiceTitle(type) {
  const titles = {
    'UMKM_TERPERCAYA': 'UMKM Terpercaya',
    'UMKM_PILIHAN': 'UMKM Pilihan',
    'BLANJAAN_PLAY': 'BlanjaanPlay Promo Video',
    'IKLAN_BANNER': 'Iklan Banner Unggulan'
  };
  return titles[type] || type;
}
