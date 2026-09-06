/**
 * BLANJAAN Worker — Email helper (Resend API)
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const OTP_MINUTES = 10;
const BRAND_NAME = 'BLANJAAN';

/**
 * Kirim OTP via Resend API
 * @param {object} env - Cloudflare env (butuh RESEND_API_KEY)
 * @param {string} email - Alamat email tujuan
 * @param {string} otp - 6-digit OTP code
 */
export async function sendOtpEmail(env, email, otp) {
  if (!env.RESEND_API_KEY) {
    // Development mode: log ke console jika API key belum diset
    console.log(`[DEV] OTP untuk ${email}: ${otp}`);
    return { dev_mode: true, otp };
  }

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #fff;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="background: #EE4D2D; display: inline-block; padding: 12px 24px; border-radius: 8px;">
          <span style="color: white; font-size: 22px; font-weight: 900; letter-spacing: 1px;">${BRAND_NAME}</span>
        </div>
      </div>
      <h2 style="color: #222; font-size: 20px; font-weight: 700; margin-bottom: 8px;">Kode Login Anda</h2>
      <p style="color: #555; font-size: 14px; margin-bottom: 24px;">Gunakan kode berikut untuk masuk ke ${BRAND_NAME}:</p>
      <div style="background: #FFF3F0; border: 2px solid #EE4D2D; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 42px; font-weight: 900; color: #EE4D2D; letter-spacing: 8px;">${otp}</span>
      </div>
      <p style="color: #888; font-size: 12px; margin-bottom: 8px;">Kode berlaku selama <strong>${OTP_MINUTES} menit</strong>.</p>
      <p style="color: #888; font-size: 12px;">Jangan berikan kode ini kepada siapa pun termasuk tim ${BRAND_NAME}.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="color: #aaa; font-size: 11px; text-align: center;">Email ini dikirim oleh ${BRAND_NAME}. Jika Anda tidak meminta kode ini, abaikan email ini.</p>
    </div>
  `;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${BRAND_NAME} <noreply@${getEmailDomain(env)}>`,
      to: [email],
      subject: `Kode Login ${BRAND_NAME}: ${otp}`,
      html: htmlBody,
      text: `Kode login ${BRAND_NAME} Anda: ${otp}\n\nKode berlaku ${OTP_MINUTES} menit.\nJangan berikan kode ini kepada siapa pun.\n\n${BRAND_NAME}`
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[Email] Resend error:', err);
    // Jangan lempar error — OTP tetap tersimpan di DB, user bisa retry
    return { sent: false, error: err };
  }

  return { sent: true };
}

/**
 * Kirim email notifikasi umum
 */
export async function sendNotificationEmail(env, to, subject, htmlBody, textBody) {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV] Email ke ${to}: ${subject}`);
    return { dev_mode: true };
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${BRAND_NAME} <noreply@${getEmailDomain(env)}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: htmlBody,
      text: textBody || subject
    })
  });

  return res.ok ? { sent: true } : { sent: false };
}

function getEmailDomain(env) {
  // Gunakan domain dari SUPABASE_URL jika tidak ada RESEND_FROM_DOMAIN
  if (env.RESEND_FROM_DOMAIN) return env.RESEND_FROM_DOMAIN;
  return 'blanjaan.up2digital.workers.dev';
}
