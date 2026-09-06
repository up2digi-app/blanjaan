/**
 * BLANJAAN Worker — User Handler
 * updateMyProfile, setPassword, requestPasswordReset, verifyPasswordResetOtp, uploadProfileImage
 */

import { supabaseFrom, supabaseStorageUpload } from '../lib/supabase.js';
import { requireSession, findUserById, findUserByEmail, userToApi, auditLog } from '../lib/auth.js';
import {
  sha256,
  generateId,
  generateUUID,
  normalizeEmail,
  normalizeText,
  normalizeWhatsApp,
  randomOtp,
  nowIso
} from '../lib/crypto.js';
import { sendOtpEmail } from '../lib/email.js';

const OTP_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

export async function handleUser(action, payload, env) {
  switch (action) {
    case 'updateMyProfile':
      return await updateMyProfile(env, payload);

    case 'setPassword':
      return await setPassword(env, payload);

    case 'requestPasswordReset':
      return await requestPasswordReset(env, payload);

    case 'verifyPasswordResetOtp':
      return await verifyPasswordResetOtp(env, payload);

    case 'uploadProfileImage':
      return await uploadProfileImage(env, payload);

    default:
      throw new Error(`Action user '${action}' tidak dikenali.`);
  }
}

export async function updateMyProfile(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!user) throw new Error('User tidak ditemukan.');

  const fields = {
    display_name: normalizeText(payload.display_name),
    phone: normalizeWhatsApp(payload.phone),
    city: normalizeText(payload.city),
    address: normalizeText(payload.address),
    updated_at: nowIso()
  };

  if (payload.profile_image !== undefined) {
    fields.profile_image = normalizeText(payload.profile_image);
  }

  await supabaseFrom(env, 'users')
    .eq('user_id', user.user_id)
    .update(fields);

  await auditLog(env, user.user_id, 'UPDATE_PROFILE', 'USER', user.user_id, fields);

  const updatedUser = await findUserById(env, user.user_id);
  return { user: userToApi(updatedUser) };
}

export async function setPassword(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const password = validatePassword(payload.password);

  const salt = `${generateUUID()}${generateUUID()}`;
  const hash = await sha256(`${salt}:${password}`);
  const now = nowIso();

  await supabaseFrom(env, 'users')
    .eq('user_id', session.user_id)
    .update({
      password_hash: hash,
      password_salt: salt,
      password_updated_at: now,
      updated_at: now
    });

  await auditLog(env, session.user_id, 'SET_PASSWORD', 'USER', session.user_id, { has_password: true });

  return { has_password: true, updated_at: now };
}

export async function requestPasswordReset(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  if (!email) throw new Error('Email wajib diisi.');

  const user = await findUserByEmail(env, email);
  if (!user) throw new Error('Akun dengan email tersebut tidak ditemukan.');

  // Rate limit check
  const existingRows = await supabaseFrom(env, 'auth')
    .select('auth_id,created_at,otp_expires_at,otp_used_at')
    .eq('email', email)
    .eq('auth_type', 'OTP')
    .eq('otp_purpose', 'PASSWORD_RESET')
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
  const now = nowIso();
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60000).toISOString();

  await supabaseFrom(env, 'auth').insert({
    auth_id: authId,
    auth_type: 'OTP',
    user_id: user.user_id,
    email,
    otp_hash: otpHash,
    otp_expires_at: expiresAt,
    otp_attempts: 0,
    otp_purpose: 'PASSWORD_RESET',
    active: true,
    created_at: now,
    updated_at: now
  });

  await sendOtpEmail(env, email, otp);
  await auditLog(env, user.user_id, 'REQUEST_PASSWORD_RESET', 'USER', user.user_id, { email });

  return {
    resend_after_seconds: OTP_RESEND_SECONDS,
    expires_in_seconds: OTP_MINUTES * 60
  };
}

export async function verifyPasswordResetOtp(env, payload = {}) {
  const email = normalizeEmail(payload.email);
  const otp = String(payload.otp || '').trim();
  const password = validatePassword(payload.password);

  if (!email || !/^\d{6}$/.test(otp)) {
    throw new Error('Email dan OTP tidak valid.');
  }

  const rows = await supabaseFrom(env, 'auth')
    .select('*')
    .eq('email', email)
    .eq('auth_type', 'OTP')
    .eq('otp_purpose', 'PASSWORD_RESET')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(5)
    .execute();

  const activeOtps = (rows || []).filter(r => !r.otp_used_at);
  if (!activeOtps.length) {
    throw new Error('OTP reset tidak ditemukan.');
  }

  const otpRow = activeOtps[0];
  const attempts = Number(otpRow.otp_attempts || 0);

  if (new Date(otpRow.otp_expires_at).getTime() <= Date.now()) {
    throw new Error('OTP reset sudah kedaluwarsa.');
  }
  if (attempts >= MAX_OTP_ATTEMPTS) {
    throw new Error('Terlalu banyak percobaan OTP.');
  }

  // Increment attempts
  await supabaseFrom(env, 'auth')
    .eq('auth_id', otpRow.auth_id)
    .update({ otp_attempts: attempts + 1, updated_at: nowIso() });

  const inputHash = await sha256(otp);
  if (inputHash !== String(otpRow.otp_hash)) {
    throw new Error('OTP reset salah.');
  }

  // Mark used
  await supabaseFrom(env, 'auth')
    .eq('auth_id', otpRow.auth_id)
    .update({ otp_used_at: nowIso(), active: false, updated_at: nowIso() });

  const user = await findUserByEmail(env, email);
  if (!user) throw new Error('Akun tidak ditemukan.');

  const salt = `${generateUUID()}${generateUUID()}`;
  const hash = await sha256(`${salt}:${password}`);
  const now = nowIso();

  await supabaseFrom(env, 'users')
    .eq('user_id', user.user_id)
    .update({
      password_hash: hash,
      password_salt: salt,
      password_updated_at: now,
      updated_at: now
    });

  await auditLog(env, user.user_id, 'VERIFY_PASSWORD_RESET_OTP', 'USER', user.user_id, {});

  return { reset: true, has_password: true };
}

export async function uploadProfileImage(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const data = String(payload.data_base64 || '').trim();
  const mime = String(payload.mime_type || 'image/jpeg').trim();

  if (!data) throw new Error('File gambar tidak ditemukan.');
  if (data.length > 4 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar. Maksimal 3 MB.');

  let url = '';
  try {
    const rawBinary = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const filename = `profile_${session.user_id}_${Date.now()}.jpg`;
    url = await supabaseStorageUpload(env, 'blanjaan-media', `profiles/${filename}`, rawBinary, mime);
  } catch (err) {
    // If Supabase storage is not yet provisioned, fall back to data URL or error
    if (payload.image_url) {
      url = payload.image_url;
    } else {
      url = `data:${mime};base64,${data}`;
    }
  }

  await supabaseFrom(env, 'users')
    .eq('user_id', session.user_id)
    .update({ profile_image: url, updated_at: nowIso() });

  const fresh = await findUserById(env, session.user_id);
  await auditLog(env, session.user_id, 'UPLOAD_PROFILE_IMAGE', 'USER', session.user_id, { url });

  return { profile_image: url, user: userToApi(fresh) };
}

function validatePassword(p) {
  const str = String(p || '');
  if (str.length < 8) throw new Error('Password minimal 8 karakter.');
  if (str.length > 128) throw new Error('Password maksimal 128 karakter.');
  return str;
}
