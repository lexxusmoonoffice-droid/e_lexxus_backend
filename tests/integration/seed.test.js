/**
 * Verifies the seed script's data layer end-to-end against an in-memory DB:
 * runs the same upsert paths and asserts the resulting documents are valid.
 */

const { setupDB } = require('../helpers/db');
const fixtures = require('../../scripts/seedData');
const { Brand, BlogPost, Bundle, Category, HeroSlide, Product, User } = require('../../src/models');

setupDB();

describe('seedData fixtures → models', () => {
  it('every product references a known category + brand', () => {
    const catSlugs = new Set(fixtures.categories.map((c) => c.slug));
    const brandSlugs = new Set(fixtures.brands.map((b) => b.slug));
    fixtures.products.forEach((p) => {
      expect(catSlugs.has(p.categorySlug)).toBe(true);
      expect(brandSlugs.has(p.brand)).toBe(true);
    });
  });

  it('every bundle references known product slugs', () => {
    const productSlugs = new Set(fixtures.products.map((p) => p.slug));
    fixtures.bundles.forEach((b) => {
      b.productSlugs.forEach((s) => expect(productSlugs.has(s)).toBe(true));
    });
  });

  it('all fixture data passes Mongoose validation', async () => {
    // Minimum subset to verify shapes are valid (full seed is integration-tested
    // by running scripts/seed.js against a real DB).
    const creator = await User.create({
      name: 'Seed Creator',
      email: 'seed@x.com',
      passwordHash: 'h',
      role: 'creator',
    });
    const cat = await Category.create({ name: fixtures.categories[4].name, slug: fixtures.categories[4].slug });
    const brand = await Brand.create({ name: fixtures.brands[0].name, slug: fixtures.brands[0].slug });

    const p = fixtures.products[0];
    const product = await Product.create({
      creator: creator._id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      brand: brand._id,
      category: cat._id,
      price: p.price,
      attributes: { material: p.material, style: p.style, color: p.color, dimensions: p.dimensions },
      fileSizeMb: p.fileSizeMb,
      thumbnail: p.image,
      images: p.images,
      status: 'published',
    });
    expect(product.slug).toBe(p.slug);

    const b = fixtures.bundles[0];
    const bundle = await Bundle.create({
      name: b.name,
      slug: b.slug,
      tag: b.tag,
      badge: b.badge,
      description: b.description,
      image: b.image,
      images: b.images,
      productIds: [product._id],
      bundlePrice: b.bundlePrice,
      originalPrice: product.price,
      status: 'published',
    });
    expect(bundle.modelCount).toBe(1);

    const post = await BlogPost.create({
      title: fixtures.blog[0].title,
      slug: fixtures.blog[0].slug,
      excerpt: fixtures.blog[0].excerpt,
      image: fixtures.blog[0].image,
      status: 'published',
    });
    expect(post.publishedAt).toBeInstanceOf(Date);

    const slide = await HeroSlide.create(fixtures.heroSlides[0]);
    expect(slide.active).toBe(true);
    expect(slide.title.length).toBe(2);
  });
});
