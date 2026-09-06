/**
 * BLANJAAN Worker — Orders & Cart Handler
 * createOrder, markOrderWhatsappOpened, getMyOrders, saveCart, getMyCart
 */

import { supabaseFrom } from '../lib/supabase.js';
import { requireSession, findUserById, auditLog } from '../lib/auth.js';
import { generateId, normalizeId, normalizeText, nowIso } from '../lib/crypto.js';

export async function handleOrders(action, payload, env) {
  switch (action) {
    case 'createOrder':
      return await createOrder(env, payload);

    case 'markOrderWhatsappOpened':
      return await markOrderWhatsappOpened(env, payload);

    case 'getMyOrders':
      return await getMyOrders(env, payload);

    case 'saveCart':
      return await saveCart(env, payload);

    case 'getMyCart':
      return await getMyCart(env, payload);

    default:
      throw new Error(`Action orders '${action}' tidak dikenali.`);
  }
}

export async function createOrder(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const sellerId = normalizeText(payload.seller_id);
  if (!sellerId) throw new Error('Seller ID wajib diisi.');

  let items = payload.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (_) { items = []; }
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Item pesanan kosong.');
  }

  const user = await findUserById(env, session.user_id);
  const sellerRows = await supabaseFrom(env, 'sellers')
    .select('seller_id,owner_user_id')
    .eq('seller_id', sellerId)
    .execute();

  if (!sellerRows || !sellerRows.length) {
    throw new Error('Toko tidak ditemukan.');
  }

  if (normalizeId(sellerRows[0].owner_user_id) === normalizeId(session.user_id)) {
    throw new Error('Anda tidak dapat memesan dari toko milik sendiri.');
  }

  const buyerName = normalizeText(payload.buyer_name) ||
    normalizeText(user && user.display_name) ||
    normalizeText(user && user.email) ||
    'Buyer';

  const total = Number(payload.total || 0);
  const totalItems = Math.max(0, parseInt(payload.total_items, 10) || items.reduce((sum, i) => sum + Math.max(1, Number(i.qty || 1)), 0));
  const shippingFee = Math.max(0, Number(payload.shipping_fee || 0));
  const orderId = generateId('ORD');
  const now = nowIso();

  // Create order
  await supabaseFrom(env, 'orders').insert({
    order_id: orderId,
    user_id: session.user_id,
    seller_id: sellerId,
    buyer_name: buyerName,
    address: normalizeText(payload.address),
    notes: normalizeText(payload.notes),
    total_items: totalItems,
    total,
    shipping_fee: shippingFee,
    status: 'PENDING',
    order_type: 'ORDER',
    created_at: now,
    updated_at: now
  });

  // Create order items
  const itemRows = items.map((i, idx) => {
    const qty = Math.max(1, Number(i.qty || 1));
    const price = Number(i.price || i.addedPrice || 0);
    return {
      order_item_id: `${orderId}_I${idx + 1}`,
      order_id: orderId,
      product_id: normalizeText(i.product_id || i.productId),
      product_name: normalizeText(i.name),
      variant: normalizeText(i.variant),
      qty,
      price,
      subtotal: qty * price,
      created_at: now,
      updated_at: now
    };
  });

  await supabaseFrom(env, 'order_items').insert(itemRows);

  await auditLog(env, session.user_id, 'CREATE_ORDER', 'ORDER', orderId, {
    seller_id: sellerId,
    total,
    total_items: totalItems
  });

  return {
    order_id: orderId,
    status: 'PENDING',
    buyer_name: buyerName,
    total_items: totalItems,
    shipping_fee: shippingFee
  };
}

export async function markOrderWhatsappOpened(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const orderId = normalizeId(payload.order_id);
  if (!orderId) throw new Error('Order ID wajib diisi.');

  const rows = await supabaseFrom(env, 'orders')
    .select('order_id,user_id')
    .eq('order_id', orderId)
    .execute();

  if (!rows || !rows.length || normalizeId(rows[0].user_id) !== normalizeId(session.user_id)) {
    throw new Error('Order tidak ditemukan.');
  }

  const now = nowIso();
  await supabaseFrom(env, 'orders')
    .eq('order_id', orderId)
    .update({
      whatsapp_opened_at: now,
      status: 'CONTACTED',
      updated_at: now
    });

  // Clear user cart
  await clearUserCart(env, session.user_id);

  return {
    success: true,
    order_id: orderId,
    whatsapp_opened_at: now,
    status: 'CONTACTED'
  };
}

export async function getMyOrders(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);

  const orders = await supabaseFrom(env, 'orders')
    .select('*')
    .eq('user_id', session.user_id)
    .neq('order_type', 'CART')
    .order('created_at', { ascending: false })
    .execute();

  if (!orders || !orders.length) return [];

  const orderIds = orders.map(o => o.order_id);
  const items = await supabaseFrom(env, 'order_items')
    .select('*')
    .in('order_id', orderIds)
    .execute();

  // Get sellers for store names
  const sellerIds = [...new Set(orders.map(o => o.seller_id))];
  const sellers = await supabaseFrom(env, 'sellers')
    .select('seller_id,store_name')
    .in('seller_id', sellerIds)
    .execute();

  const sellerMap = {};
  (sellers || []).forEach(s => { sellerMap[s.seller_id] = s.store_name; });

  const itemsMap = {};
  (items || []).forEach(item => {
    if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
    itemsMap[item.order_id].push({
      product_id: normalizeId(item.product_id),
      name: normalizeText(item.product_name),
      variant: normalizeText(item.variant),
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      subtotal: Number(item.subtotal || 0)
    });
  });

  return orders.map(o => {
    const contacted = String(o.status || '').toUpperCase() === 'CONTACTED';
    return {
      order_id: normalizeId(o.order_id),
      user_id: normalizeId(o.user_id),
      seller_id: normalizeId(o.seller_id),
      seller_name: normalizeText(sellerMap[o.seller_id]) || 'Toko',
      buyer_name: normalizeText(o.buyer_name),
      address: normalizeText(o.address),
      notes: normalizeText(o.notes),
      total_items: Math.max(0, Number(o.total_items || 0)),
      total: Number(o.total || 0),
      shipping_fee: Math.max(0, Number(o.shipping_fee || 0)),
      status: normalizeText(o.status),
      order_type: normalizeText(o.order_type || 'ORDER'),
      whatsapp_opened_at: o.whatsapp_opened_at,
      can_rate: contacted,
      created_at: o.created_at,
      updated_at: o.updated_at,
      items: itemsMap[o.order_id] || []
    };
  });
}

export async function saveCart(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);
  const userId = session.user_id;

  let items = payload.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (_) { items = []; }
  }
  if (!Array.isArray(items)) items = [];

  // Remove existing cart orders and cart order_items
  await clearUserCart(env, userId);

  if (!items.length) return { saved: true, item_count: 0 };

  const grouped = {};
  items.forEach(item => {
    const sellerId = normalizeText(item.seller_id);
    if (!sellerId) return;
    if (!grouped[sellerId]) grouped[sellerId] = [];
    grouped[sellerId].push({
      product_id: normalizeText(item.product_id),
      name: normalizeText(item.name),
      variant: normalizeText(item.variant),
      qty: Math.max(1, Number(item.qty || 1)),
      price: Math.max(0, Number(item.price || item.addedPrice || 0))
    });
  });

  for (const sellerId of Object.keys(grouped)) {
    const group = grouped[sellerId];
    const now = nowIso();
    const orderId = generateId('CRT');
    const total = group.reduce((sum, x) => sum + x.qty * x.price, 0);
    const totalQty = group.reduce((sum, x) => sum + x.qty, 0);

    await supabaseFrom(env, 'orders').insert({
      order_id: orderId,
      user_id: userId,
      seller_id: sellerId,
      total_items: totalQty,
      total,
      shipping_fee: 0,
      status: 'CART',
      order_type: 'CART',
      created_at: now,
      updated_at: now
    });

    const itemRows = group.map((x, idx) => ({
      order_item_id: `${orderId}_I${idx + 1}`,
      order_id: orderId,
      product_id: x.product_id,
      product_name: x.name,
      variant: x.variant,
      qty: x.qty,
      price: x.price,
      subtotal: x.qty * x.price,
      created_at: now,
      updated_at: now
    }));

    await supabaseFrom(env, 'order_items').insert(itemRows);
  }

  return { saved: true, item_count: items.length };
}

export async function getMyCart(env, payload = {}) {
  const session = await requireSession(env, payload.session_token);

  const cartOrders = await supabaseFrom(env, 'orders')
    .select('order_id,seller_id')
    .eq('user_id', session.user_id)
    .eq('order_type', 'CART')
    .execute();

  if (!cartOrders || !cartOrders.length) return { items: [] };

  const cartOrderIds = cartOrders.map(o => o.order_id);
  const sellerByOrder = {};
  cartOrders.forEach(o => { sellerByOrder[o.order_id] = o.seller_id; });

  const items = await supabaseFrom(env, 'order_items')
    .select('*')
    .in('order_id', cartOrderIds)
    .execute();

  const result = (items || []).map(i => ({
    product_id: normalizeId(i.product_id),
    seller_id: normalizeId(sellerByOrder[i.order_id]),
    name: normalizeText(i.product_name),
    variant: normalizeText(i.variant),
    qty: Number(i.qty || 1),
    price: Number(i.price || 0)
  }));

  return { items: result };
}

async function clearUserCart(env, userId) {
  try {
    const carts = await supabaseFrom(env, 'orders')
      .select('order_id')
      .eq('user_id', userId)
      .eq('order_type', 'CART')
      .execute();

    if (carts && carts.length) {
      const orderIds = carts.map(c => c.order_id);
      await supabaseFrom(env, 'order_items')
        .in('order_id', orderIds)
        .delete();

      await supabaseFrom(env, 'orders')
        .eq('user_id', userId)
        .eq('order_type', 'CART')
        .delete();
    }
  } catch (_) {}
}
