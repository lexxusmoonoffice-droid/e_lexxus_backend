/**
 * Schema-level tests for every model.
 * Uses an in-memory MongoDB (mongodb-memory-server) so we exercise
 * Mongoose validation, plugins, indexes, and pre-save hooks
 * without needing a real DB.
 */

const mongoose = require('mongoose');
const { setupDB } = require('../../helpers/db');
const {
  AuditLog,
  Brand,
  BlogPost,
  Bundle,
  Cart,
  Category,
  HeroSlide,
  Notification,
  Order,
  Product,
  RefreshToken,
  Review,
  Settings,
  User,
  Wishlist,
} = require('../../../src/models');

setupDB();

async function makeUser(over = {}) {
  return User.create({
    name: 'Test User',
    email: `t${Date.now()}${Math.random()}@x.com`,
    passwordHash: 'x',
    ...over,
  });
}

async function makeCategory(over = {}) {
  return Category.create({ name: 'Sofas', slug: `sofas-${Date.now()}`, ...over });
}

async function makeBrand(over = {}) {
  return Brand.create({ name: 'Brand', slug: `brand-${Date.now()}`, ...over });
}

async function makeProduct(over = {}) {
  const creator = over.creator || (await makeUser({ role: 'creator' }));
  const category = over.category || (await makeCategory());
  return Product.create({
    creator: creator._id,
    title: 'Sofa Test',
    slug: `sofa-test-${Date.now()}`,
    description: 'desc',
    category: category._id,
    price: 1000,
    ...over,
  });
}

describe('User', () => {
  it('hides passwordHash from toJSON and exposes virtual id + initials', async () => {
    const u = await User.create({
      name: 'Alex Novak',
      email: 'alex@x.com',
      passwordHash: 'secret',
    });
    const json = u.toJSON();
    expect(json.id).toBeDefined();
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.passwordHash).toBeUndefined();
    expect(json.initials).toBe('AN');
    expect(json.role).toBe('buyer');
    expect(json.status).toBe('active');
  });

  it('rejects invalid email and duplicate emails', async () => {
    await expect(
      User.create({ name: 'x', email: 'not-an-email', passwordHash: 'h' }),
    ).rejects.toBeDefined();
    await User.create({ name: 'x', email: 'a@b.com', passwordHash: 'h' });
    await expect(
      User.create({ name: 'y', email: 'a@b.com', passwordHash: 'h' }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Category', () => {
  it('auto-generates slug from name', async () => {
    const c = await Category.create({ name: 'Wall Decor' });
    expect(c.slug).toBe('wall-decor');
  });

  it('supports parent self-ref', async () => {
    const parent = await Category.create({ name: 'Models' });
    const child = await Category.create({ name: 'Sofas', parent: parent._id });
    expect(child.parent.toString()).toBe(parent._id.toString());
  });
});

describe('Brand', () => {
  it('auto-slugs', async () => {
    const b = await Brand.create({ name: 'Wall Deco' });
    expect(b.slug).toBe('wall-deco');
  });
});

describe('Product', () => {
  it('flips isFree when price is 0 and slugs from title', async () => {
    const creator = await makeUser({ role: 'creator' });
    const category = await makeCategory();
    const p = await Product.create({
      creator: creator._id,
      title: 'Office Desk Xander',
      description: 'desc',
      category: category._id,
      price: 0,
    });
    expect(p.slug).toBe('office-desk-xander');
    expect(p.isFree).toBe(true);
    expect(p.status).toBe('draft');
  });

  it('sets publishedAt when status=published', async () => {
    const p = await makeProduct({ status: 'published' });
    expect(p.publishedAt).toBeInstanceOf(Date);
  });

  it('paginate plugin returns standard envelope', async () => {
    await makeProduct({ slug: 'a-1', status: 'published' });
    await makeProduct({ slug: 'a-2', status: 'published' });
    await makeProduct({ slug: 'a-3', status: 'draft' });
    const res = await Product.paginate({ status: 'published' }, { limit: 1 });
    expect(res.total).toBe(2);
    expect(res.pages).toBe(2);
    expect(res.data.length).toBe(1);
  });
});

describe('Bundle', () => {
  it('computes modelCount + savingsPct', async () => {
    const p1 = await makeProduct({ price: 1000 });
    const p2 = await makeProduct({ price: 1000 });
    const b = await Bundle.create({
      name: 'Bundle X',
      bundlePrice: 1500,
      originalPrice: 2000,
      productIds: [p1._id, p2._id],
    });
    expect(b.modelCount).toBe(2);
    expect(b.savingsPct).toBe(25);
    expect(b.slug).toBe('bundle-x');
  });

  it('rejects empty productIds', async () => {
    await expect(
      Bundle.create({ name: 'Empty', bundlePrice: 100, productIds: [] }),
    ).rejects.toBeDefined();
  });
});

describe('Order', () => {
  it('requires at least one item', async () => {
    const buyer = await makeUser();
    await expect(
      Order.create({ buyer: buyer._id, items: [], subtotal: 0, total: 0 }),
    ).rejects.toBeDefined();
  });

  it('defaults status to pending and downloadLimit to 5', async () => {
    const buyer = await makeUser();
    const product = await makeProduct();
    const o = await Order.create({
      buyer: buyer._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 500 }],
      subtotal: 500,
      total: 500,
    });
    expect(o.status).toBe('pending');
    expect(o.downloadLimit).toBe(5);
    expect(o.downloadCount).toBe(0);
  });

  it('enforces uniqueness of downloadToken', async () => {
    const buyer = await makeUser();
    const product = await makeProduct();
    await Order.create({
      buyer: buyer._id,
      items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1 }],
      subtotal: 1,
      total: 1,
      downloadToken: 'tok-1',
    });
    await expect(
      Order.create({
        buyer: buyer._id,
        items: [{ type: 'product', product: product._id, qty: 1, priceAtPurchase: 1 }],
        subtotal: 1,
        total: 1,
        downloadToken: 'tok-1',
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Cart', () => {
  it('one cart per user (unique)', async () => {
    const u = await makeUser();
    await Cart.create({ user: u._id });
    await expect(Cart.create({ user: u._id })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Wishlist', () => {
  it('one wishlist per user, supports product + bundle ids', async () => {
    const u = await makeUser();
    const p = await makeProduct();
    const w = await Wishlist.create({ user: u._id, productIds: [p._id] });
    expect(w.productIds.length).toBe(1);
    await expect(Wishlist.create({ user: u._id })).rejects.toMatchObject({ code: 11000 });
  });
});

describe('BlogPost', () => {
  it('auto-slugs and stamps publishedAt when published', async () => {
    const post = await BlogPost.create({ title: 'Hello World', status: 'published' });
    expect(post.slug).toBe('hello-world');
    expect(post.publishedAt).toBeInstanceOf(Date);
  });
});

describe('HeroSlide', () => {
  it('requires title length === 2', async () => {
    await expect(
      HeroSlide.create({ img: 'http://x', title: ['only one'] }),
    ).rejects.toBeDefined();
    const ok = await HeroSlide.create({ img: 'http://x', title: ['L1', 'L2'] });
    expect(ok.active).toBe(true);
  });
});

describe('Settings', () => {
  it('getSettings returns same singleton across calls', async () => {
    const a = await Settings.getSettings();
    const b = await Settings.getSettings();
    expect(a._id.toString()).toBe(b._id.toString());
    expect(a.storeName).toBe('Lexxus');
    expect(a.payments.zohoEnabled).toBe(true);
  });
});

describe('Review', () => {
  it('one review per (product, user)', async () => {
    const u = await makeUser();
    const p = await makeProduct();
    await Review.create({ product: p._id, user: u._id, rating: 5 });
    await expect(
      Review.create({ product: p._id, user: u._id, rating: 4 }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects rating outside 1..5', async () => {
    const u = await makeUser();
    const p = await makeProduct();
    await expect(
      Review.create({ product: p._id, user: u._id, rating: 6 }),
    ).rejects.toBeDefined();
  });
});

describe('RefreshToken', () => {
  it('hides tokenHash, requires jti unique', async () => {
    const u = await makeUser();
    const t = await RefreshToken.create({
      user: u._id,
      jti: 'jti-1',
      tokenHash: 'h',
      family: 'fam-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(t.toJSON().tokenHash).toBeUndefined();
    await expect(
      RefreshToken.create({
        user: u._id,
        jti: 'jti-1',
        tokenHash: 'h',
        family: 'fam-2',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('AuditLog', () => {
  it('creates with mixed before/after payloads', async () => {
    const u = await makeUser({ role: 'admin' });
    const log = await AuditLog.create({
      actor: u._id,
      action: 'product.update',
      entity: 'Product',
      entityId: new mongoose.Types.ObjectId().toString(),
      before: { price: 100 },
      after: { price: 120 },
    });
    expect(log.action).toBe('product.update');
    expect(log.before.price).toBe(100);
  });
});

describe('Notification', () => {
  it('defaults read=false', async () => {
    const u = await makeUser();
    const n = await Notification.create({
      user: u._id,
      type: 'order.paid',
      title: 'Paid',
    });
    expect(n.read).toBe(false);
  });
});
