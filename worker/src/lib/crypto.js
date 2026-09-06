/**
 * BLANJAAN Worker — Crypto helpers
 * Menggunakan Web Crypto API (native di Cloudflare Workers)
 */

/**
 * SHA-256 hash (hex string) — pengganti Utilities.computeDigest GAS
 */
export async function sha256(input) {
  const data = new TextEncoder().encode(String(input));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate random UUID v4
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Generate 6-digit OTP
 */
export function randomOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

/**
 * Generate session token (UUID + UUID)
 */
export function generateSessionToken() {
  return `${generateUUID()}-${generateUUID()}`;
}

/**
 * Normalize ID: trim, return empty string if null/undefined
 */
export function normalizeId(v) {
  return v ? String(v).trim() : '';
}

/**
 * Normalize text: trim string
 */
export function normalizeText(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

/**
 * Normalize email: trim + lowercase
 */
export function normalizeEmail(v) {
  return normalizeText(v).toLowerCase();
}

/**
 * Normalize WhatsApp number to 62xxx format
 */
export function normalizeWhatsApp(wa) {
  let s = normalizeText(wa).replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('62')) return s;
  if (s.startsWith('0')) return '62' + s.substring(1);
  if (s.startsWith('8')) return '62' + s;
  return s;
}

/**
 * Convert to boolean
 */
export function toBool(v) {
  const s = String(v).trim().toUpperCase();
  return v === true || v === 1 || s === 'TRUE' || s === 'YES' || s === '1';
}

/**
 * Parse variants string "A|B|C" → array
 */
export function parseVariants(v) {
  const s = normalizeText(v);
  if (!s) return [];
  return s.split('|').map(normalizeText).filter(Boolean);
}

/**
 * Normalize variants array → pipe-separated string
 */
export function normalizeVariants(v) {
  if (Array.isArray(v)) return v.map(normalizeText).filter(Boolean).join('|');
  if (typeof v === 'string') return v.trim();
  return '';
}

/**
 * Parse comma-separated list → array
 */
export function parseList(v) {
  const s = normalizeText(v);
  if (!s) return [];
  return s.split(',').map(normalizeText).filter(Boolean);
}

/**
 * ISO timestamp now
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Generate prefixed ID: prefix + 12 char from UUID
 */
export function generateId(prefix = '') {
  return prefix + generateUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
}
