/**
 * BLANJAAN Worker — Admin Handler
 * getAdminDashboard, reviewSellerApplication, setAdminRole, getTokenTarif, setTokenTarif
 */

import { supabaseFrom, getConfigValue } from '../lib/supabase.js';
import { requireSession, findUserById, isAdminUser, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, nowIso } from '../lib/crypto.js';

export async function handleAdmin(action, payload, env) {
  switch (action) {
    case 'getAdminDashboard':
      return await getAdminDashboard(env, payload);

    case 'getSellerApplications':
      return await getSellerApplications(env, payload);

    case 'reviewSellerApplication':
      return await reviewSellerApplication(env, payload);

    case 'setAdminRole':
      return await setAdminRole(env, payload);

    case 'getTokenTarif':
      return await getTokenTarif(env, payload);

    case 'setTokenTarif':
      return await setTokenTarif(env, payload);

    default:
      throw new Error(`Action admin '${action}' tidak dikenali.`);
  }
}

export async function getAdminDashboard(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const [
    users,
    sellers,
    products,
    orders,
    sellerApps,
    serviceApps,
    flashBatches
  ] = await Promise.all([
    supabaseFrom(env, 'users').select('user_id').execute().catch(() => []),
    supabaseFrom(env, 'sellers').select('seller_id,status').execute().catch(() => []),
    supabaseFrom(env, 'products').select('product_id,status').execute().catch(() => []),
    supabaseFrom(env, 'orders').select('order_id,total,status').neq('order_type', 'CART').execute().catch(() => []),
    supabaseFrom(env, 'seller_applications').select('*').order('created_at', { ascending: false }).limit(20).execute().catch(() => []),
    supabaseFrom(env, 'service_applications').select('*').order('created_at', { ascending: false }).limit(20).execute().catch(() => []),
    supabaseFrom(env, 'flash_sale_batches').select('*').execute().catch(() => [])
  ]);

  const activeSellers = (sellers || []).filter(s => s.status === 'ACTIVE').length;
  const activeProducts = (products || []).filter(p => p.status === 'ACTIVE').length;
  const pendingSellerApps = (sellerApps || []).filter(a => a.status === 'PENDING').length;
  const pendingServiceApps = (serviceApps || []).filter(a => a.status === 'PENDING').length;

  let totalSales = 0;
  (orders || []).forEach(o => {
    if (['COMPLETED', 'CONTACTED'].includes(String(o.status).toUpperCase())) {
      totalSales += Number(o.total || 0);
    }
  });

  return {
    metrics: {
      total_users: (users || []).length,
      total_sellers: (sellers || []).length,
      active_sellers: activeSellers,
      total_products: (products || []).length,
      active_products: activeProducts,
      total_orders: (orders || []).length,
      total_sales: totalSales,
      pending_seller_applications: pendingSellerApps,
      pending_service_applications: pendingServiceApps,
      active_flash_batches: (flashBatches || []).filter(b => b.active).length
    },
    recent_seller_applications: sellerApps || [],
    recent_service_applications: serviceApps || []
  };
}

export async function getSellerApplications(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const rows = await supabaseFrom(env, 'seller_applications')
    .select('*')
    .order('created_at', { ascending: false })
    .execute();

  return rows || [];
}

export async function reviewSellerApplication(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const applicationId = normalizeText(payload.application_id);
  const decision = normalizeText(payload.decision).toUpperCase();

  if (!applicationId || !['APPROVE', 'REJECT'].includes(decision)) {
    throw new Error('Approval action tidak valid.');
  }

  const appRows = await supabaseFrom(env, 'seller_applications')
    .select('*')
    .eq('application_id', applicationId)
    .execute();

  if (!appRows || !appRows.length) {
    throw new Error('Pengajuan toko tidak ditemukan.');
  }

  const app = appRows[0];
  const now = nowIso();

  if (decision === 'REJECT') {
    await supabaseFrom(env, 'seller_applications')
      .eq('application_id', applicationId)
      .update({
        status: 'REJECTED',
        reviewed_at: now,
        reviewed_by: session.user_id,
        rejection_reason: normalizeText(payload.reason) || 'Ditolak admin',
        updated_at: now
      });

    await auditLog(env, session.user_id, 'REJECT_SELLER_APPLICATION', 'SELLER_APPLICATION', applicationId, {
      user_id: app.user_id
    });

    return { application_id: applicationId, status: 'REJECTED' };
  }

  // APPROVE
  const sellerId = generateId('S');

  await supabaseFrom(env, 'sellers').insert({
    seller_id: sellerId,
    owner_user_id: app.user_id,
    store_name: app.store_name,
    city: app.city,
    district: '',
    wa: app.wa,
    website: '',
    logo: '',
    banner: '',
    description: app.description,
    category: app.category,
    status: 'ACTIVE',
    application_id: applicationId,
    created_at: now,
    updated_at: now
  });

  await supabaseFrom(env, 'seller_applications')
    .eq('application_id', applicationId)
    .update({
      status: 'APPROVED',
      seller_id: sellerId,
      reviewed_at: now,
      reviewed_by: session.user_id,
      rejection_reason: '',
      updated_at: now
    });

  // Update user roles to include SELLER
  const applicant = await findUserById(env, app.user_id);
  if (applicant) {
    const rolesList = (applicant.roles || 'CUSTOMER').split(',').map(r => r.trim()).filter(Boolean);
    if (!rolesList.includes('SELLER')) {
      rolesList.push('SELLER');
      await supabaseFrom(env, 'users')
        .eq('user_id', app.user_id)
        .update({ roles: rolesList.join(','), updated_at: now });
    }
  }

  await auditLog(env, session.user_id, 'APPROVE_SELLER_APPLICATION', 'SELLER_APPLICATION', applicationId, {
    seller_id: sellerId,
    user_id: app.user_id
  });

  return { application_id: applicationId, status: 'APPROVED', seller_id: sellerId };
}

export async function setAdminRole(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const targetUserId = normalizeId(payload.target_user_id || payload.user_id);
  const makeAdmin = payload.is_admin === true;

  const target = await findUserById(env, targetUserId);
  if (!target) throw new Error('User tujuan tidak ditemukan.');

  let roles = (target.roles || '').split(',').map(r => r.trim()).filter(Boolean);
  if (makeAdmin) {
    if (!roles.includes('ADMIN')) roles.push('ADMIN');
  } else {
    roles = roles.filter(r => r !== 'ADMIN');
  }

  const now = nowIso();
  await supabaseFrom(env, 'users')
    .eq('user_id', targetUserId)
    .update({ roles: roles.join(','), updated_at: now });

  await auditLog(env, session.user_id, 'SET_ADMIN_ROLE', 'USER', targetUserId, { make_admin: makeAdmin });

  return { user_id: targetUserId, roles };
}

/**
 * Fase 3: Token Tarif Configuration
 */
export async function getTokenTarif(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const [playCost, umkmCost, bannerCost] = await Promise.all([
    getConfigValue(env, 'TOKEN_COST_BLANJAAN_PLAY', '1'),
    getConfigValue(env, 'TOKEN_COST_UMKM_PILIHAN', '2'),
    getConfigValue(env, 'TOKEN_COST_IKLAN_BANNER', '3')
  ]);

  return {
    TOKEN_COST_BLANJAAN_PLAY: Number(playCost),
    TOKEN_COST_UMKM_PILIHAN: Number(umkmCost),
    TOKEN_COST_IKLAN_BANNER: Number(bannerCost)
  };
}

export async function setTokenTarif(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const keys = ['TOKEN_COST_BLANJAAN_PLAY', 'TOKEN_COST_UMKM_PILIHAN', 'TOKEN_COST_IKLAN_BANNER'];
  const now = nowIso();

  for (const key of keys) {
    if (payload[key] !== undefined) {
      const val = String(Math.max(1, Number(payload[key])));
      await supabaseFrom(env, 'app_config').upsert({
        config_key: key,
        config_value: val,
        config_type: 'NUMBER',
        description: `Biaya token untuk ${key}`,
        active: true,
        updated_at: now
      }, { onConflict: 'config_key' });
    }
  }

  await auditLog(env, session.user_id, 'SET_TOKEN_TARIF', 'CONFIG', 'TOKEN_TARIF', payload);

  return await getTokenTarif(env, payload);
}
