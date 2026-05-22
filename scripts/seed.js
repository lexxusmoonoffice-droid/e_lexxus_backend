#!/usr/bin/env node
/**
 * Seed script — populates MongoDB with the same fixture data the
 * Next.js apps currently render statically. Idempotent (upserts by slug).
 *
 *   npm run seed            → upsert (safe to re-run)
 *   npm run seed:reset      → drop collections then upsert
 */

/* eslint-disable no-console */
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const env = require('../src/config/env');
const dbConn = require('../src/config/db');
const {
  Brand,
  BlogPost,
  Bundle,
  Category,
  HeroSlide,
  Product,
  Settings,
  User,
} = require('../src/models');

const fixtures = require('./seedData');

const RESET = process.argv.includes('--reset');

async function seedUsers() {
  const map = {};
  for (const u of fixtures.users) {
    const passwordHash = await bcrypt.hash(u.password, env.BCRYPT_COST);
    const doc = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          name: u.name,
          role: u.role,
          verified: u.verified,
          bio: u.bio,
          status: 'active',
        },
        $set: { passwordHash },
      },
      { upsert: true, new: true },
    );
    map[u.email] = doc;
  }
  console.log(`  · ${Object.keys(map).length} users`);
  return map;
}

async function seedCategories() {
  const map = {};
  // Top-level first
  for (const c of fixtures.categories.filter((x) => !x.parent)) {
    const doc = await Category.findOneAndUpdate(
      { slug: c.slug },
      { $set: { name: c.name, slug: c.slug, status: 'active' } },
      { upsert: true, new: true },
    );
    map[c.slug] = doc;
  }
  // Sub-cats
  for (const c of fixtures.categories.filter((x) => x.parent)) {
    const parent = map[c.parent];
    const doc = await Category.findOneAndUpdate(
      { slug: c.slug },
      { $set: { name: c.name, slug: c.slug, parent: parent?._id, status: 'active' } },
      { upsert: true, new: true },
    );
    map[c.slug] = doc;
  }
  console.log(`  · ${Object.keys(map).length} categories`);
  return map;
}

async function seedBrands() {
  const map = {};
  for (const b of fixtures.brands) {
    const doc = await Brand.findOneAndUpdate(
      { slug: b.slug },
      { $set: { name: b.name, slug: b.slug, country: b.country, status: 'active' } },
      { upsert: true, new: true },
    );
    map[b.slug] = doc;
  }
  console.log(`  · ${Object.keys(map).length} brands`);
  return map;
}

async function seedProducts({ creator, brands, categories }) {
  const map = {};
  for (const p of fixtures.products) {
    const brandDoc = brands[p.brand];
    const categoryDoc = categories[p.categorySlug];
    if (!categoryDoc) {
      console.warn(`    ! product "${p.slug}" missing category ${p.categorySlug}, skipped`);
      continue;
    }
    const status = p.status || 'published';
    const doc = await Product.findOneAndUpdate(
      { slug: p.slug },
      {
        $set: {
          creator: creator._id,
          title: p.title,
          slug: p.slug,
          description: p.description,
          brand: brandDoc?._id,
          category: categoryDoc._id,
          tags: [p.style, p.color, p.material].filter(Boolean),
          price: p.price,
          isFree: p.price === 0,
          attributes: {
            material: p.material,
            style: p.style,
            color: p.color,
            dimensions: p.dimensions,
          },
          fileSizeMb: p.fileSizeMb,
          thumbnail: p.image,
          images: p.images || [],
          status,
          publishedAt: status === 'published' ? new Date() : undefined,
          views: p.views || 0,
          likes: p.likes || 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    map[p.slug] = doc;
  }
  console.log(`  · ${Object.keys(map).length} products`);
  return map;
}

async function seedBundles({ products }) {
  const map = {};
  for (const b of fixtures.bundles) {
    const productDocs = b.productSlugs.map((s) => products[s]).filter(Boolean);
    const originalPrice = productDocs.reduce((sum, p) => sum + (p.price || 0), 0);
    const doc = await Bundle.findOneAndUpdate(
      { slug: b.slug },
      {
        $set: {
          name: b.name,
          slug: b.slug,
          tag: b.tag,
          badge: b.badge,
          description: b.description,
          image: b.image,
          images: b.images || [],
          productIds: productDocs.map((p) => p._id),
          bundlePrice: b.bundlePrice,
          originalPrice,
          fileSizeMb: b.fileSizeMb,
          formats: b.formats || [],
          status: 'published',
          publishedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    map[b.slug] = doc;
  }
  console.log(`  · ${Object.keys(map).length} bundles`);
  return map;
}

async function seedBlog({ creator }) {
  let n = 0;
  for (const post of fixtures.blog) {
    await BlogPost.findOneAndUpdate(
      { slug: post.slug },
      {
        $set: {
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          image: post.image,
          author: creator._id,
          authorName: creator.name,
          status: post.status,
          publishedAt: post.status === 'published' ? new Date() : undefined,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    n += 1;
  }
  console.log(`  · ${n} blog posts`);
}

async function seedHeroSlides() {
  let n = 0;
  for (const s of fixtures.heroSlides) {
    await HeroSlide.findOneAndUpdate(
      { order: s.order },
      { $set: s },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    n += 1;
  }
  console.log(`  · ${n} hero slides`);
}

async function seedSettings() {
  await Settings.getSettings();
  console.log('  · settings ensured');
}

async function reset() {
  const models = [Brand, BlogPost, Bundle, Category, HeroSlide, Product, Settings, User];
  for (const M of models) {
    await M.deleteMany({});
  }
  console.log('  · dropped all seeded collections');
}

async function main() {
  console.log(`\n📦 Seeding ${env.MONGODB_URI}`);
  await dbConn.connect();

  if (RESET) {
    console.log('\n🧹 RESET');
    await reset();
  }

  console.log('\n👥 Users');
  const users = await seedUsers();
  const creator = users['studio@lexxus.com'];

  console.log('\n🗂  Categories');
  const categories = await seedCategories();

  console.log('\n🏷  Brands');
  const brands = await seedBrands();

  console.log('\n🛋  Products');
  const products = await seedProducts({ creator, brands, categories });

  console.log('\n📚 Bundles');
  await seedBundles({ products });

  console.log('\n📝 Blog');
  await seedBlog({ creator });

  console.log('\n🎬 Hero slides');
  await seedHeroSlides();

  console.log('\n⚙️  Settings');
  await seedSettings();

  console.log('\n✅ Seed complete\n');
  await dbConn.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n❌ Seed failed:', err);
  await dbConn.disconnect().catch(() => {});
  process.exit(1);
});
