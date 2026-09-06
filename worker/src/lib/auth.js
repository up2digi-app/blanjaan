/**
 * BLANJAAN Worker — Auth session management
 * Translasi dari requireSession_, createSessionForUser_, getSessionByToken_ di Code.gs
 */

import { supabaseFrom } from './supabase.js';
import { sha256, generateUUID, generateId, normalizeId, normalizeText, nowIso, toBool } from './crypto.js';

const SESSION_TTL_HOURS = 24;
const REMEMBER_SESSION_DAYS = 30;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Validate session token dan return session row.
 * Throw jika tidak valid/expired.
 */
export async function requireSession(env, token) {
  token = normalizeText(token);
  if (!token) throw new Error('Sesi tidak valid.');

  const session = await getSessionByToken(env, token);
  if (!session) throw new Error('Sesi tidak ditemukan.');
  if (!toBool(session.active)) throw new Error('Sesi sudah tidak aktif.');

  const expiresAt = new Date(session.session_expires_at).getTime();
  if (expiresAt <= Date.now()) {
    // Mark inactive di background, jangan tunggu
    supabaseFrom(env, 'auth')
      .eq('auth_id', session.auth_id)
      .update({ active: false, updated_at: nowIso() })
      .catch(() => {});
    throw new Error('Sesi sudah kedaluwarsa.');
  }

  // Update last_seen_at (non-blocking)
  supabaseFrom(env, 'auth')
    .eq('auth_id', session.auth_id)
    .update({ last_seen_at: nowIso(), updated_at: nowIso() })
    .catch(() => {});

  return session;
}

/**
 * Cari session berdasarkan token hash
 */
export async function getSessionByToken(env, token) {
  token = normalizeText(token);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const rows = await supabaseFrom(env, 'auth')
    .select('auth_id,auth_type,user_id,token_hash,session_expires_at,active,last_seen_at')
    .eq('auth_type', 'SESSION')
    .eq('token_hash', tokenHash)
    .eq('active', true)
    .execute();

  if (!rows || !rows.length) return null;
  return rows[0];
}

/**
 * Buat session baru untuk user yang sudah terverifikasi.
 * Return: { session_token, expires_at, user, seller, seller_application }
 */
export async function createSessionForUser(env, user, remember = false) {
  const token = `${generateUUID()}-${generateUUID()}`;
  const tokenHash = await sha256(token);
  const authId = generateId('SES');
  const now = nowIso();
  const hoursToAdd = remember ? REMEMBER_SESSION_DAYS * 24 : SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + hoursToAdd * 3600000).toISOString();

  await supabaseFrom(env, 'auth').insert({
    auth_id: authId,
    auth_type: 'SESSION',
    user_id: user.user_id,
    email: user.email,
    token_hash: tokenHash,
    session_expires_at: expiresAt,
    session_created_at: now,
    last_seen_at: now,
    remember_me: remember,
    active: true,
    created_at: now,
    updated_at: now
  });

  // Update last_login_at
  await supabaseFrom(env, 'users')
    .eq('user_id', user.user_id)
    .update({ last_login_at: now, updated_at: now });

  // Audit
  await auditLog(env, user.user_id, 'AUTH_LOGIN', 'USER', user.user_id, { remember_me: remember });

  // Ambil seller & application
  const seller = await getSellerForUser(env, user.user_id);
  const sellerApplication = await getSellerApplicationForUser(env, user.user_id);
  const sellerServices = seller ? await getSellerServices(env, user.user_id, seller.seller_id) : [];

  return {
    session_token: token,
    expires_at: expiresAt,
    user: userToApi(user),
    seller,
    seller_application: sellerApplication,
    seller_services: sellerServices
  };
}

/**
 * Logout: nonaktifkan session
 */
export async function invalidateSession(env, token) {
  token = normalizeText(token);
  if (!token) return { logged_out: true };
  const tokenHash = await sha256(token);
  await supabaseFrom(env, 'auth')
    .eq('token_hash', tokenHash)
    .update({ active: false, updated_at: nowIso() });
  return { logged_out: true };
}

/* ─────────────────────────────────────────────────────── */
/* User helpers                                           */
/* ─────────────────────────────────────────────────────── */

export async function findUserByEmail(env, email) {
  const rows = await supabaseFrom(env, 'users')
    .eq('email', email.toLowerCase().trim())
    .execute();
  return rows && rows[0] ? rows[0] : null;
}

export async function findUserById(env, userId) {
  const rows = await supabaseFrom(env, 'users')
    .eq('user_id', userId)
    .execute();
  return rows && rows[0] ? rows[0] : null;
}

export function userToApi(r) {
  return {
    user_id: normalizeId(r.user_id),
    email: normalizeText(r.email).toLowerCase(),
    display_name: normalizeText(r.display_name),
    phone: normalizeText(r.phone),
    city: normalizeText(r.city),
    address: normalizeText(r.address),
    profile_image: normalizeText(r.profile_image),
    roles: parseList(r.roles),
    status: normalizeText(r.status).toUpperCase(),
    has_password: !!(normalizeText(r.password_hash))
  };
}

/* ─────────────────────────────────────────────────────── */
/* Seller helpers                                         */
/* ─────────────────────────────────────────────────────── */

export async function getSellerForUser(env, userId) {
  const rows = await supabaseFrom(env, 'sellers')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('status', 'ACTIVE')
    .execute();
  if (!rows || !rows.length) return null;
  return sellerToApi(rows[0]);
}

export async function getSellerApplicationForUser(env, userId) {
  const rows = await supabaseFrom(env, 'seller_applications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .execute();
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return {
    application_id: normalizeId(r.application_id),
    user_id: normalizeId(r.user_id),
    seller_id: normalizeId(r.seller_id),
    store_name: normalizeText(r.store_name),
    wa: normalizeText(r.wa),
    category: normalizeText(r.category),
    city: normalizeText(r.city),
    description: normalizeText(r.description),
    status: normalizeText(r.status).toUpperCase(),
    created_at: r.created_at,
    updated_at: r.updated_at,
    reviewed_at: r.reviewed_at,
    reviewed_by: normalizeId(r.reviewed_by),
    rejection_reason: normalizeText(r.rejection_reason)
  };
}

export async function getSellerServices(env, userId, sellerId) {
  try {
    const rows = await supabaseFrom(env, 'seller_entitlements')
      .select('*')
      .eq('seller_id', sellerId)
      .eq('status', 'ACTIVE')
      .execute();
    return rows || [];
  } catch (_) {
    return [];
  }
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
    status: normalizeText(r.status).toUpperCase()
  };
}

/* ─────────────────────────────────────────────────────── */
/* Role check                                             */
/* ─────────────────────────────────────────────────────── */

export function isAdminUser(user) {
  const roles = parseList(user.roles || '');
  return roles.some(r => ['ADMIN', 'SUPERADMIN'].includes(r.toUpperCase()));
}

/* ─────────────────────────────────────────────────────── */
/* Audit log                                              */
/* ─────────────────────────────────────────────────────── */

export async function auditLog(env, userId, action, entityType, entityId, payload = {}) {
  try {
    await supabaseFrom(env, 'audit_log').insert({
      audit_id: generateId('AUD'),
      user_id: userId || '',
      action: action || '',
      entity_type: entityType || '',
      entity_id: entityId || '',
      payload_json: JSON.stringify(payload),
      created_at: nowIso()
    });
  } catch (_) {
    // Audit tidak boleh merusak operasi utama
  }
}

/* ─────────────────────────────────────────────────────── */
/* Helpers                                                */
/* ─────────────────────────────────────────────────────── */

function parseList(v) {
  const s = normalizeText(v);
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}
