/**
 * BLANJAAN Worker — Hero Banner Handler (Fase 3)
 * Full CRUD for Hero Banners
 */

import { supabaseFrom } from '../lib/supabase.js';
import { requireSession, findUserById, isAdminUser, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, toBool, nowIso } from '../lib/crypto.js';

export async function handleBanners(action, payload, env) {
  switch (action) {
    case 'getBanners':
    case 'adminGetBanners':
      return await getBanners(env, payload);

    case 'createBanner':
      return await createBanner(env, payload);

    case 'updateBanner':
      return await updateBanner(env, payload);

    case 'deleteBanner':
      return await deleteBanner(env, payload);

    default:
      throw new Error(`Action banners '${action}' tidak dikenali.`);
  }
}

export async function getBanners(env, payload = {}) {
  let query = supabaseFrom(env, 'media')
    .select('*')
    .eq('usage', 'HERO');

  // If public, active only
  if (!payload.all) {
    query = query.eq('active', true);
  }

  query = query.order('sort_order', { ascending: true });
  const rows = await query.execute();

  return (rows || []).map(r => ({
    banner_id: normalizeId(r.entity_id || r.asset_id),
    asset_id: normalizeId(r.asset_id),
    image_url: normalizeText(r.url),
    title_html: normalizeText(r.title),
    subtitle: normalizeText(r.subtitle),
    sort_order: Number(r.sort_order || 0),
    active: toBool(r.active),
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
}

export async function createBanner(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const imageUrl = normalizeText(payload.image_url);
  if (!imageUrl) throw new Error('URL gambar banner wajib diisi.');

  const bannerId = generateId('BNR');
  const now = nowIso();

  await supabaseFrom(env, 'media').insert({
    asset_id: bannerId,
    entity_id: bannerId,
    url: imageUrl,
    title: normalizeText(payload.title_html || payload.title),
    subtitle: normalizeText(payload.subtitle),
    usage: 'HERO',
    asset_type: 'IMAGE',
    sort_order: Number(payload.sort_order || 0),
    active: payload.active !== undefined ? payload.active === true : true,
    created_at: now,
    updated_at: now
  });

  await auditLog(env, session.user_id, 'CREATE_HERO_BANNER', 'BANNER', bannerId, { url: imageUrl });

  return { banner_id: bannerId, saved: true };
}

export async function updateBanner(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const bannerId = normalizeId(payload.banner_id || payload.asset_id);
  if (!bannerId) throw new Error('banner_id wajib diisi.');

  const fields = {
    updated_at: nowIso()
  };

  if (payload.image_url !== undefined) fields.url = normalizeText(payload.image_url);
  if (payload.title_html !== undefined || payload.title !== undefined) {
    fields.title = normalizeText(payload.title_html !== undefined ? payload.title_html : payload.title);
  }
  if (payload.subtitle !== undefined) fields.subtitle = normalizeText(payload.subtitle);
  if (payload.sort_order !== undefined) fields.sort_order = Number(payload.sort_order);
  if (payload.active !== undefined) fields.active = payload.active === true;

  await supabaseFrom(env, 'media')
    .eq('asset_id', bannerId)
    .update(fields);

  await auditLog(env, session.user_id, 'UPDATE_HERO_BANNER', 'BANNER', bannerId, fields);

  return { banner_id: bannerId, updated: true };
}

export async function deleteBanner(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const user = await findUserById(env, session.user_id);
  if (!isAdminUser(user)) throw new Error('Akses admin diperlukan.');

  const bannerId = normalizeId(payload.banner_id || payload.asset_id);
  if (!bannerId) throw new Error('banner_id wajib diisi.');

  await supabaseFrom(env, 'media')
    .eq('asset_id', bannerId)
    .delete();

  await auditLog(env, session.user_id, 'DELETE_HERO_BANNER', 'BANNER', bannerId, {});

  return { banner_id: bannerId, deleted: true };
}
