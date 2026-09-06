/**
 * BLANJAAN Worker — Auth Handler
 * checkLoginMethod, requestOtp, verifyOtp, loginPassword, me, validateSession, logout
 */

import { supabaseFrom } from '../lib/supabase.js';
import {
  requireSession,
  createSessionForUser,
  invalidateSession,
  findUserByEmail,
  findUserById,
  userToApi,
  getSellerForUser,
  getSellerApplicationForUser,
  getSellerServices,
  auditLog
} from '../lib/auth.js';
import {
  sha256,
  generateId,
  normalizeEmail,
  normalizeText,
  randomOtp,
  toBool,
  nowIso
} from '../lib/crypto.js';
import { sendOtpEmail } from '../lib/email.js';

const OTP_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

export async function handleAuth(action, payload, env) {
  switch (action) {
    case 'authCheckLoginMethod':
      return await authCheckLoginMethod(env, payload);

    case 'authRequestOtp':
      return await authRequestOtp(env, payload);

    case 'authVerifyOtp':
      return await authVerifyOtp(env, payload);

    case 'authLoginPassword':
      return await authLoginPassword(env, payload);

    case 'authMe':
      return await authMe(env, payload);

    case 'authValidateSession':
      return await authValidateSession(env, payload);

    case 'authLogout':
      return await authLogout(env, payload);

    default:
      throw new Error(`Action auth '${action}' tidak dikenali.`);
  }
}

export async function authCheckLoginMethod(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  if (!email) throw new Error('Email aktif wajib diisi.');

  const user = await findUserByEmail(env, email);
  if (!user) return { exists: false, has_password: false };

  return {
    exists: true,
    has_password: !!normalizeText(user.password_hash),
    email
  };
}

export async function authRequestOtp(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  if (!email) throw new Error('Email aktif wajib diisi.');

  let user = await findUserByEmail(env, email);
  const now = nowIso();

  if (!user) {
    const userId = generateId('U');
    await supabaseFrom(env, 'users').insert({
      user_id: userId,
      email,
      display_name: email.split('@')[0],
      roles: 'CUSTOMER',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now
    });
    user = await findUserByEmail(env, email);
  }

  // Check existing unexpired OTP for rate limit
  const existingRows = await supabaseFrom(env, 'auth')
    .select('auth_id,created_at,otp_expires_at,otp_used_at')
    .eq('email', email)
    .eq('auth_type', 'OTP')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .execute();

  if (existingRows && existingRows.length) {
    const latest = existingRows[0];
    if (!latest.otp_used_at && new Date(latest.otp_expires_at).getTime() > Date.now()) {
      const elapsed = Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 1000);
      if (elapsed < OTP_RESEND_SECONDS) {
        return { resend_after_seconds: OTP_RESEND_SECONDS - elapsed };
      }
    }
  }

  const otp = randomOtp();
  const otpHash = await sha256(otp);
  const authId = generateId('OTP');
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60000).toISOString();

  await supabaseFrom(env, 'auth').insert({
    auth_id: authId,
    auth_type: 'OTP',
    user_id: user.user_id,
    email,
    otp_hash: otpHash,
    otp_expires_at: expiresAt,
    otp_attempts: 0,
    otp_purpose: 'LOGIN',
    active: true,
    created_at: now,
    updated_at: now
  });

  await sendOtpEmail(env, email, otp);
  await auditLog(env, user.user_id, 'AUTH_REQUEST_OTP', 'USER', user.user_id, { email });

  return {
    resend_after_seconds: OTP_RESEND_SECONDS,
    expires_in_seconds: OTP_MINUTES * 60
  };
}

export async function authVerifyOtp(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const otp = String(payload.otp || '').trim();
  const remember = toBool(payload.remember_me);

  if (!email) throw new Error('Email wajib diisi.');
  if (!/^\d{6}$/.test(otp)) throw new Error('OTP harus 6 digit.');

  const rows = await supabaseFrom(env, 'auth')
    .select('*')
    .eq('email', email)
    .eq('auth_type', 'OTP')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(5)
    .execute();

  const activeOtps = (rows || []).filter(r =>
    !r.otp_used_at &&
    String(r.otp_purpose || 'LOGIN').toUpperCase() === 'LOGIN'
  );

  if (!activeOtps.length) {
    throw new Error('OTP tidak ditemukan. Minta kode baru.');
  }

  const otpRow = activeOtps[0];
  const attempts = Number(otpRow.otp_attempts || 0);

  if (new Date(otpRow.otp_expires_at).getTime() <= Date.now()) {
    throw new Error('OTP sudah kedaluwarsa. Minta kode baru.');
  }
  if (attempts >= MAX_OTP_ATTEMPTS) {
    throw new Error('Terlalu banyak percobaan OTP. Minta kode baru.');
  }

  // Increment attempts
  await supabaseFrom(env, 'auth')
    .eq('auth_id', otpRow.auth_id)
    .update({ otp_attempts: attempts + 1, updated_at: nowIso() });

  const inputHash = await sha256(otp);
  if (inputHash !== String(otpRow.otp_hash)) {
    throw new Error('Kode OTP salah.');
  }

  // Mark used
  await supabaseFrom(env, 'auth')
    .eq('auth_id', otpRow.auth_id)
    .update({ otp_used_at: nowIso(), active: false, updated_at: nowIso() });

  const user = await findUserByEmail(env, email);
  if (!user) throw new Error('Akun tidak ditemukan.');

  return await createSessionForUser(env, user, remember);
}

export async function authLoginPassword(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');
  const remember = toBool(payload.remember_me);

  if (!email) throw new Error('Email aktif wajib diisi.');
  if (!password) throw new Error('Password wajib diisi.');

  const user = await findUserByEmail(env, email);
  if (!user || !normalizeText(user.password_hash) || !normalizeText(user.password_salt)) {
    throw new Error('Email atau password salah.');
  }

  const expectedHash = await sha256(`${user.password_salt}:${password}`);
  if (expectedHash !== String(user.password_hash)) {
    throw new Error('Email atau password salah.');
  }

  return await createSessionForUser(env, user, remember);
}

export async function authMe(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!user) throw new Error('User tidak ditemukan.');

  const seller = await getSellerForUser(env, user.user_id);
  const sellerApplication = await getSellerApplicationForUser(env, user.user_id);
  const sellerServices = seller ? await getSellerServices(env, user.user_id, seller.seller_id) : [];

  return {
    user: userToApi(user),
    seller,
    seller_application: sellerApplication,
    seller_services: sellerServices,
    expires_at: session.session_expires_at
  };
}

export async function authValidateSession(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!user) throw new Error('User tidak ditemukan.');

  return {
    valid: true,
    expires_at: session.session_expires_at,
    user_id: session.user_id
  };
}

export async function authLogout(env, payload = {}) {
  const token = normalizeText(payload.session_token);
  if (!token) return { logged_out: true };
  return await invalidateSession(env, token);
}
