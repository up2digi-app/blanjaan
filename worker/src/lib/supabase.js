/**
 * BLANJAAN Worker — Supabase REST helper
 * Semua operasi database via Supabase REST API (fetch-based, tanpa SDK)
 */

const SUPABASE_REST_VERSION = 'v1';

/**
 * Buat instance helper Supabase untuk tabel tertentu.
 * @param {object} env - Cloudflare env bindings
 * @param {string} table - Nama tabel
 * @returns {SupabaseTable}
 */
export function supabaseFrom(env, table) {
  const baseUrl = `${env.SUPABASE_URL}/rest/${SUPABASE_REST_VERSION}/${table}`;
  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  return new SupabaseTable(baseUrl, headers);
}

class SupabaseTable {
  constructor(baseUrl, headers) {
    this._base = baseUrl;
    this._headers = headers;
    this._query = '';
    this._select = '*';
    this._order = '';
    this._limit = '';
    this._single = false;
  }

  select(cols = '*') {
    this._select = cols;
    return this;
  }

  eq(col, val) {
    this._query += `&${encodeURIComponent(col)}=eq.${encodeURIComponent(val)}`;
    return this;
  }

  neq(col, val) {
    this._query += `&${encodeURIComponent(col)}=neq.${encodeURIComponent(val)}`;
    return this;
  }

  in(col, vals) {
    const list = vals.map(v => encodeURIComponent(v)).join(',');
    this._query += `&${encodeURIComponent(col)}=in.(${list})`;
    return this;
  }

  ilike(col, pattern) {
    this._query += `&${encodeURIComponent(col)}=ilike.${encodeURIComponent(pattern)}`;
    return this;
  }

  order(col, { ascending = true } = {}) {
    this._order = `&order=${encodeURIComponent(col)}.${ascending ? 'asc' : 'desc'}`;
    return this;
  }

  limit(n) {
    this._limit = `&limit=${n}`;
    return this;
  }

  range(from, to) {
    this._headers = { ...this._headers, 'Range': `${from}-${to}` };
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  _buildUrl() {
    return `${this._base}?select=${encodeURIComponent(this._select)}${this._query}${this._order}${this._limit}`;
  }

  async execute() {
    const hdrs = { ...this._headers };
    if (this._single) hdrs['Accept'] = 'application/vnd.pgrst.object+json';
    const res = await fetch(this._buildUrl(), { headers: hdrs });
    return handleSupabaseResponse(res);
  }

  // Alias
  async all() { return this.execute(); }

  async insert(data) {
    const body = Array.isArray(data) ? data : [data];
    const res = await fetch(this._base, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify(body)
    });
    return handleSupabaseResponse(res);
  }

  async upsert(data, { onConflict = '' } = {}) {
    const body = Array.isArray(data) ? data : [data];
    const url = onConflict ? `${this._base}?on_conflict=${encodeURIComponent(onConflict)}` : this._base;
    const hdrs = { ...this._headers, 'Prefer': 'resolution=merge-duplicates,return=representation' };
    const res = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(body)
    });
    return handleSupabaseResponse(res);
  }

  async update(data) {
    const res = await fetch(this._buildUrl(), {
      method: 'PATCH',
      headers: this._headers,
      body: JSON.stringify(data)
    });
    return handleSupabaseResponse(res);
  }

  async delete() {
    const res = await fetch(this._buildUrl(), {
      method: 'DELETE',
      headers: this._headers
    });
    return handleSupabaseResponse(res);
  }
}

async function handleSupabaseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

  if (!res.ok) {
    const msg = (data && data.message) || (data && data.hint) || `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Upload file ke Supabase Storage
 */
export async function supabaseStorageUpload(env, bucket, path, body, contentType) {
  const url = `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload error: ${err}`);
  }
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Baca satu config key dari app_config
 */
export async function getConfigValue(env, key, defaultVal = '') {
  try {
    const rows = await supabaseFrom(env, 'app_config')
      .select('config_value')
      .eq('config_key', key)
      .eq('active', true)
      .execute();
    return rows && rows[0] ? rows[0].config_value : defaultVal;
  } catch (_) {
    return defaultVal;
  }
}

/**
 * Baca banyak config key sekaligus → object key:value
 */
export async function getMultiConfig(env, keys = []) {
  try {
    const rows = await supabaseFrom(env, 'app_config')
      .select('config_key,config_value')
      .in('config_key', keys)
      .eq('active', true)
      .execute();
    const out = {};
    (rows || []).forEach(r => { out[r.config_key] = r.config_value; });
    return out;
  } catch (_) {
    return {};
  }
}
