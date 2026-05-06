/**
 * Cart service — server-side cart for authenticated users.
 * Items are either {product, qty} or {bundle, qty}. Existence of the
 * referenced product/bundle is verified at add time.
 */

const AppError = require('../utils/AppError');
const { Cart, Product, Bundle } = require('../models');

const POPULATE = [
  { path: 'items.product', populate: ['brand', 'category'] },
  { path: 'items.bundle' },
];

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

async function loadCart(userId) {
  await getOrCreateCart(userId); // ensure exists
  return Cart.findOne({ user: userId }).populate(POPULATE);
}

async function assertProductExists(id) {
  const exists = await Product.exists({ _id: id, status: 'published' });
  if (!exists) throw AppError.notFound('Product not available');
}
async function assertBundleExists(id) {
  const exists = await Bundle.exists({ _id: id, status: 'published' });
  if (!exists) throw AppError.notFound('Bundle not available');
}

function findItemIndex(cart, type, id) {
  const key = type === 'product' ? 'product' : 'bundle';
  return cart.items.findIndex((it) => it[key] && it[key].toString() === id.toString());
}

async function addItem(userId, { productId, bundleId, qty }) {
  if (productId) await assertProductExists(productId);
  if (bundleId) await assertBundleExists(bundleId);
  const cart = await getOrCreateCart(userId);

  const type = productId ? 'product' : 'bundle';
  const id = productId || bundleId;
  const idx = findItemIndex(cart, type, id);
  if (idx >= 0) {
    cart.items[idx].qty = Math.min(99, cart.items[idx].qty + qty);
  } else {
    cart.items.push(
      type === 'product'
        ? { product: id, qty }
        : { bundle: id, qty },
    );
  }
  await cart.save();
  return loadCart(userId);
}

async function updateItem(userId, { type, id, qty }) {
  const cart = await getOrCreateCart(userId);
  const idx = findItemIndex(cart, type, id);
  if (idx < 0) throw AppError.notFound('Item not in cart');
  cart.items[idx].qty = qty;
  await cart.save();
  return loadCart(userId);
}

async function removeItem(userId, { type, id }) {
  const cart = await getOrCreateCart(userId);
  const idx = findItemIndex(cart, type, id);
  if (idx < 0) throw AppError.notFound('Item not in cart');
  cart.items.splice(idx, 1);
  await cart.save();
  return loadCart(userId);
}

async function clearCart(userId) {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
  return loadCart(userId);
}

/**
 * Merge a client-side (e.g. localStorage) cart into the server cart.
 * Quantities sum, capped at 99. Used right after login.
 */
async function mergeCart(userId, items) {
  const cart = await getOrCreateCart(userId);
  for (const incoming of items) {
    const type = incoming.productId ? 'product' : 'bundle';
    const id = incoming.productId || incoming.bundleId;
    // Verify the ref still exists so we don't poison the cart.
    // eslint-disable-next-line no-await-in-loop
    const exists = await (type === 'product'
      ? Product.exists({ _id: id, status: 'published' })
      : Bundle.exists({ _id: id, status: 'published' }));
    if (!exists) continue;
    const idx = findItemIndex(cart, type, id);
    if (idx >= 0) {
      cart.items[idx].qty = Math.min(99, cart.items[idx].qty + (incoming.qty || 1));
    } else {
      cart.items.push(
        type === 'product'
          ? { product: id, qty: incoming.qty || 1 }
          : { bundle: id, qty: incoming.qty || 1 },
      );
    }
  }
  await cart.save();
  return loadCart(userId);
}

module.exports = {
  loadCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  mergeCart,
};
