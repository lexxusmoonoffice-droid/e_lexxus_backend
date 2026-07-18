const { z } = require('zod');
const mongoose = require('mongoose');

const objectId = z
  .string()
  .refine((s) => mongoose.isValidObjectId(s), { message: 'Invalid id' });

const idParam = z.object({ id: objectId });

const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(20000).default(20),
    sort: z.string().optional(),
    status: z.string().optional(),
    q: z.string().trim().optional(),
  })
  .passthrough();

/* ── Products ───────────────────────────────────────────────── */
const dimensions = z
  .object({
    w: z.coerce.number().optional(),
    l: z.coerce.number().optional(),
    h: z.coerce.number().optional(),
  })
  .partial();

const productCreate = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().optional(),
  description: z.string().default(''),
  brand: objectId.optional().nullable(),
  category: objectId,
  subCategory: objectId.optional().nullable(),
  tags: z.array(z.string()).optional(),
  price: z.coerce.number().min(0),
  currency: z.string().optional(),
  attributes: z
    .object({
      material: z.string().optional(),
      style: z.string().optional(),
      color: z.string().optional(),
      dimensions: dimensions.optional(),
    })
    .optional(),
  fileSizeMb: z.coerce.number().optional(),
  formats: z.array(z.string()).optional(),
  thumbnail: z.string().optional(),
  hoverImage: z.string().optional(),
  images: z.array(z.string()).optional(),
  status: z.enum(['draft', 'review', 'published', 'removed']).optional(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImage: z.string().optional(),
    })
    .optional(),
});

const productUpdate = productCreate.partial();

const productStatusPatch = z.object({
  status: z.enum(['draft', 'review', 'published', 'removed']),
});

const productBulk = z.object({
  ids: z.array(objectId).min(1),
  action: z.enum(['publish', 'unpublish', 'delete']),
});

/* ── Bundles ────────────────────────────────────────────────── */
const bundleCreate = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  tag: z.string().optional(),
  badge: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  productIds: z.array(objectId).min(1),
  bundlePrice: z.coerce.number().min(0),
  originalPrice: z.coerce.number().optional(),
  fileSizeMb: z.coerce.number().optional(),
  formats: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'removed']).optional(),
});
const bundleUpdate = bundleCreate.partial();

const categoryUpsert = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  parent: objectId.nullable().optional(),
  image: z.string().nullable().optional(),
  order: z.coerce.number().int().optional(),
  status: z.enum(['active', 'hidden']).optional(),
  banners: z
    .array(
      z.object({
        img: z.string().min(1),
        title: z.string().default(''),
        sub: z.string().default(''),
        href: z.string().optional(),
      })
    )
    .optional(),
});

/* ── Brands ─────────────────────────────────────────────────── */
const brandUpsert = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  logo: z.string().optional(),
  hero: z.string().optional(),
  description: z.string().optional(),
  country: z.string().optional(),
  status: z.enum(['active', 'hidden']).optional(),
});

/* ── Blog ───────────────────────────────────────────────────── */
const blogUpsert = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  authorName: z.string().optional(),
  image: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published']).optional(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      ogImage: z.string().optional(),
    })
    .optional(),
});

/* ── Hero slides ────────────────────────────────────────────── */
const heroUpsert = z.object({
  order: z.coerce.number().int().optional(),
  active: z.coerce.boolean().optional(),
  img: z.string().min(1),
  tag: z.string().optional(),
  title: z.array(z.string()).length(2),
  sub: z.string().optional(),
  cta: z.string().optional(),
  href: z.string().optional(),
  accent: z.string().optional(),
  styles: z.object({
    tagSize:    z.coerce.number().min(8).max(24).optional(),
    titleSize:  z.coerce.number().min(1).max(12).optional(),
    subSize:    z.coerce.number().min(10).max(36).optional(),
    ctaSize:    z.coerce.number().min(8).max(24).optional(),
    accentSize: z.coerce.number().min(8).max(24).optional(),
  }).optional(),
});
const heroReorder = z.object({ ids: z.array(objectId).min(1) });

/* ── Users ──────────────────────────────────────────────────── */
const userStatusPatch = z.object({ status: z.enum(['active', 'suspended']) });

/* ── Orders ─────────────────────────────────────────────────── */
const orderStatusPatch = z.object({
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'cancelled']),
});
const orderRefund = z.object({ reason: z.string().max(500).optional() });

/* ── Settings ───────────────────────────────────────────────── */
const settingsUpdate = z
  .object({
    storeName: z.string().optional(),
    supportEmail: z.string().email().or(z.literal('')).optional(),
    defaultCurrency: z.string().optional(),
    payments: z
      .object({
        zohoEnabled: z.coerce.boolean().optional(),
        stripeEnabled: z.coerce.boolean().optional(),
        paypalEnabled: z.coerce.boolean().optional(),
      })
      .optional(),
    social: z.record(z.string()).optional(),
    seo: z
      .object({
        siteTitle: z.string().optional(),
        siteDescription: z.string().optional(),
        ogImage: z.string().optional(),
      })
      .optional(),
    legal: z
      .object({
        privacyUrl: z.string().optional(),
        termsUrl: z.string().optional(),
        refundUrl: z.string().optional(),
      })
      .optional(),
    contact: z
      .object({
        email: z.string().email().or(z.literal('')).optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        hours: z.string().optional(),
        locationLabel: z.string().optional(),
        locationImage: z.string().optional(),
        responseTimes: z
          .object({
            general: z.string().optional(),
            technical: z.string().optional(),
            billing: z.string().optional(),
            partnerships: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const socialLinkCreate = z.object({
  platform: z.string().trim().min(1),
  url: z.string().trim().url(),
  active: z.coerce.boolean().optional(),
  order: z.coerce.number().int().optional(),
});

const socialLinkUpdate = socialLinkCreate.partial();

module.exports = {
  idParam,
  listQuery,
  productCreate,
  productUpdate,
  productStatusPatch,
  productBulk,
  bundleCreate,
  bundleUpdate,
  categoryUpsert,
  brandUpsert,
  blogUpsert,
  heroUpsert,
  heroReorder,
  userStatusPatch,
  orderStatusPatch,
  orderRefund,
  settingsUpdate,
  socialLinkCreate,
  socialLinkUpdate,
};
