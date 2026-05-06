/**
 * OpenAPI 3.0 spec for the Lexxus REST API.
 *
 * We build this programmatically (rather than JSDoc-driven) so it's
 * one file to read/diff. Route handlers elsewhere link to this spec
 * via `/api/docs`.
 */

const env = require('../config/env');

const bearer = [{ bearerAuth: [] }];

/* ─── reusable bits ───────────────────────────────────────────── */

const errorEnvelope = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
};

const paginated = (itemRef) => ({
  type: 'object',
  properties: {
    data: { type: 'array', items: { $ref: itemRef } },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    pages: { type: 'integer' },
  },
});

const responses = {
  400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
};

/* ─── schemas ─────────────────────────────────────────────────── */

const schemas = {
  Error: errorEnvelope,
  Money: { type: 'number', description: 'Amount in the given currency (INR rupees by default).' },

  User: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['buyer', 'creator', 'admin'] },
      verified: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'suspended'] },
      avatar: { type: 'string', nullable: true },
      bio: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  Product: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      brand: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Brand' }] },
      category: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Category' }] },
      tags: { type: 'array', items: { type: 'string' } },
      price: { $ref: '#/components/schemas/Money' },
      currency: { type: 'string', default: 'INR' },
      isFree: { type: 'boolean' },
      attributes: {
        type: 'object',
        properties: {
          material: { type: 'string' },
          style: { type: 'string' },
          color: { type: 'string' },
          dimensions: {
            type: 'object',
            properties: { w: { type: 'number' }, l: { type: 'number' }, h: { type: 'number' } },
          },
        },
      },
      fileSizeMb: { type: 'number' },
      thumbnail: { type: 'string' },
      images: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['draft', 'review', 'published', 'removed'] },
      rating: {
        type: 'object',
        properties: { avg: { type: 'number' }, count: { type: 'integer' } },
      },
    },
  },

  Bundle: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      slug: { type: 'string' },
      name: { type: 'string' },
      tag: { type: 'string' },
      badge: { type: 'string' },
      description: { type: 'string' },
      image: { type: 'string' },
      productIds: {
        type: 'array',
        items: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Product' }] },
      },
      bundlePrice: { $ref: '#/components/schemas/Money' },
      originalPrice: { $ref: '#/components/schemas/Money' },
      savingsPct: { type: 'integer' },
      modelCount: { type: 'integer' },
      status: { type: 'string', enum: ['draft', 'published', 'removed'] },
    },
  },

  Category: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      parent: { type: 'string', nullable: true },
      productCount: { type: 'integer' },
    },
  },

  Brand: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      logo: { type: 'string' },
      description: { type: 'string' },
    },
  },

  BlogPost: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      excerpt: { type: 'string' },
      content: { type: 'string' },
      image: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time' },
    },
  },

  HeroSlide: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      order: { type: 'integer' },
      active: { type: 'boolean' },
      img: { type: 'string' },
      tag: { type: 'string' },
      title: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
      sub: { type: 'string' },
      cta: { type: 'string' },
      href: { type: 'string' },
      accent: { type: 'string' },
    },
  },

  Order: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      buyer: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/User' }] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['product', 'bundle'] },
            product: { nullable: true, $ref: '#/components/schemas/Product' },
            bundle: { nullable: true, $ref: '#/components/schemas/Bundle' },
            qty: { type: 'integer' },
            priceAtPurchase: { $ref: '#/components/schemas/Money' },
          },
        },
      },
      subtotal: { $ref: '#/components/schemas/Money' },
      total: { $ref: '#/components/schemas/Money' },
      currency: { type: 'string', default: 'INR' },
      status: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded', 'cancelled'] },
      downloadToken: { type: 'string', nullable: true },
      downloadCount: { type: 'integer' },
      downloadLimit: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};

/* ─── paths (public + user + admin) ───────────────────────────── */

const paths = {
  /* health */
  '/api/health': { get: { tags: ['Health'], summary: 'Liveness probe', responses: { 200: { description: 'OK' } } } },
  '/api/ready':  { get: { tags: ['Health'], summary: 'Readiness probe', responses: { 200: { description: 'Ready' }, 503: { description: 'Not ready' } } } },

  /* auth */
  '/api/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a buyer',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } } } } } },
      responses: { 201: { description: 'Created' }, 409: responses[409], 422: responses[422] },
    },
  },
  '/api/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } } },
      responses: { 200: { description: 'Access + refresh tokens' }, 401: responses[401] },
    },
  },
  '/api/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate refresh token', responses: { 200: { description: 'New pair' }, 401: responses[401] } } },
  '/api/auth/logout':  { post: { tags: ['Auth'], summary: 'Logout + blacklist access jti', responses: { 204: { description: 'No content' } } } },
  '/api/auth/me':      { get:  { tags: ['Auth'], summary: 'Current user', security: bearer, responses: { 200: { description: 'User', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } }, 401: responses[401] } } },
  '/api/auth/verify-email':    { post: { tags: ['Auth'], summary: 'Consume verify token', responses: { 200: { description: 'Verified' }, 400: responses[400] } } },
  '/api/auth/forgot-password': { post: { tags: ['Auth'], summary: 'Request reset email (no enumeration)', responses: { 200: { description: 'OK' } } } },
  '/api/auth/reset-password':  { post: { tags: ['Auth'], summary: 'Consume reset token', responses: { 200: { description: 'Updated' }, 400: responses[400] } } },
  '/api/auth/change-password': { put:  { tags: ['Auth'], summary: 'Change password', security: bearer, responses: { 200: { description: 'Updated' }, 401: responses[401] } } },

  /* public storefront */
  '/api/products': {
    get: {
      tags: ['Products'],
      summary: 'List published products',
      parameters: [
        { name: 'category', in: 'query', schema: { type: 'string' } },
        { name: 'brand', in: 'query', schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'priceMin', in: 'query', schema: { type: 'number' } },
        { name: 'priceMax', in: 'query', schema: { type: 'number' } },
        { name: 'free', in: 'query', schema: { type: 'boolean' } },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest', 'price_asc', 'price_desc', 'popular', 'trending'] } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 24, maximum: 100 } },
      ],
      responses: { 200: { description: 'Paginated', content: { 'application/json': { schema: paginated('#/components/schemas/Product') } } } },
    },
  },
  '/api/products/featured':     { get: { tags: ['Products'], summary: 'Featured list', responses: { 200: { description: 'OK' } } } },
  '/api/products/trending':     { get: { tags: ['Products'], summary: 'Trending list', responses: { 200: { description: 'OK' } } } },
  '/api/products/new-arrivals': { get: { tags: ['Products'], summary: 'New arrivals', responses: { 200: { description: 'OK' } } } },
  '/api/products/{slug}':       { get: { tags: ['Products'], summary: 'Product detail + related', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Detail' }, 404: responses[404] } } },
  '/api/products/{slug}/reviews': { get: { tags: ['Products'], summary: 'Public reviews (paginated)', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Paginated' } } } },

  '/api/categories':          { get: { tags: ['Categories'], summary: 'Category tree', responses: { 200: { description: 'OK' } } } },
  '/api/categories/{slug}':   { get: { tags: ['Categories'], summary: 'Category + first-page products', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: responses[404] } } },
  '/api/brands':              { get: { tags: ['Brands'], summary: 'Brands list', responses: { 200: { description: 'OK' } } } },
  '/api/brands/{slug}':       { get: { tags: ['Brands'], summary: 'Brand + products', responses: { 200: { description: 'OK' }, 404: responses[404] } } },
  '/api/bundles':             { get: { tags: ['Bundles'], summary: 'List bundles', responses: { 200: { description: 'OK' } } } },
  '/api/bundles/{slug}':      { get: { tags: ['Bundles'], summary: 'Bundle + included products', responses: { 200: { description: 'OK' }, 404: responses[404] } } },
  '/api/blog':                { get: { tags: ['Blog'], summary: 'Blog posts', responses: { 200: { description: 'OK' } } } },
  '/api/blog/{slug}':         { get: { tags: ['Blog'], summary: 'Post detail', responses: { 200: { description: 'OK' }, 404: responses[404] } } },
  '/api/hero-slides':         { get: { tags: ['Home'], summary: 'Active hero slides', responses: { 200: { description: 'OK' } } } },
  '/api/settings/public':     { get: { tags: ['Settings'], summary: 'Public settings (no secrets)', responses: { 200: { description: 'OK' } } } },
  '/api/search':              { get: { tags: ['Search'], summary: 'Global search', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } }], responses: { 200: { description: 'OK' } } } },
  '/api/currency/rates':      { get: { tags: ['Misc'], summary: 'FX rates (INR base)', responses: { 200: { description: 'OK' } } } },

  /* user */
  '/api/cart':                      { get: { tags: ['Cart'], summary: 'Current cart', security: bearer, responses: { 200: { description: 'OK' } } },
                                       delete: { tags: ['Cart'], summary: 'Empty cart', security: bearer, responses: { 200: { description: 'Cleared' } } } },
  '/api/cart/items':                { post: { tags: ['Cart'], summary: 'Add item', security: bearer, responses: { 201: { description: 'Added' }, 422: responses[422] } } },
  '/api/cart/items/{type}/{id}':    { patch: { tags: ['Cart'], summary: 'Update qty', security: bearer, responses: { 200: { description: 'OK' }, 404: responses[404] } },
                                        delete: { tags: ['Cart'], summary: 'Remove item', security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/cart/merge':                { post: { tags: ['Cart'], summary: 'Merge client cart on login', security: bearer, responses: { 200: { description: 'OK' } } } },

  '/api/wishlist':                  { get:  { tags: ['Wishlist'], security: bearer, responses: { 200: { description: 'OK' } } },
                                        post: { tags: ['Wishlist'], security: bearer, responses: { 201: { description: 'Added' } } } },
  '/api/wishlist/{type}/{id}':      { delete: { tags: ['Wishlist'], security: bearer, responses: { 200: { description: 'Removed' } } } },

  '/api/users/me':                  { get:  { tags: ['Users'], security: bearer, responses: { 200: { description: 'OK' } } },
                                        put: { tags: ['Users'], security: bearer, responses: { 200: { description: 'Updated' } } },
                                        delete: { tags: ['Users'], summary: 'GDPR delete', security: bearer, responses: { 204: { description: 'Deleted' } } } },
  '/api/users/me/export':           { get: { tags: ['Users'], summary: 'GDPR data export', security: bearer, responses: { 200: { description: 'JSON bundle' } } } },
  '/api/users/me/password':         { put: { tags: ['Users'], summary: 'Change password', security: bearer, responses: { 200: { description: 'OK' } } } },

  '/api/orders':                    { get: { tags: ['Orders'], summary: 'Own orders', security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/orders/{id}':               { get: { tags: ['Orders'], summary: 'Own order detail', security: bearer, responses: { 200: { description: 'OK' }, 404: responses[404] } } },

  '/api/downloads':                 { get: { tags: ['Downloads'], summary: 'Unlocked items', security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/downloads/{token}':         { get: { tags: ['Downloads'], summary: 'Redeem token → signed CDN URL', security: bearer, responses: { 200: { description: 'OK' }, 404: responses[404], 410: { description: 'Expired' }, 429: responses[429] } } },
  '/api/downloads/{token}/resend':  { post: { tags: ['Downloads'], summary: 'Re-email the link', security: bearer, responses: { 200: { description: 'OK' } } } },

  '/api/reviews':                   { post: { tags: ['Reviews'], summary: 'Post review (must own a paid order for the product)', security: bearer, responses: { 201: { description: 'Created' }, 403: responses[403], 409: responses[409] } } },
  '/api/reviews/{id}':              { put: { tags: ['Reviews'], summary: 'Update own review', security: bearer, responses: { 200: { description: 'OK' } } },
                                        delete: { tags: ['Reviews'], summary: 'Delete own review', security: bearer, responses: { 204: { description: 'OK' } } } },

  '/api/notifications':             { get: { tags: ['Notifications'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/notifications/{id}/read':   { patch: { tags: ['Notifications'], security: bearer, responses: { 200: { description: 'Marked read' } } } },
  '/api/notifications/read-all':    { patch: { tags: ['Notifications'], security: bearer, responses: { 200: { description: 'OK' } } } },

  /* uploads */
  '/api/uploads/product-file/presign': { post: { tags: ['Uploads'], summary: 'Presigned PUT for a product ZIP (creator/admin)', security: bearer, responses: { 200: { description: 'OK' }, 403: responses[403] } } },
  '/api/uploads/product-file/confirm': { post: { tags: ['Uploads'], summary: 'Confirm + attach uploaded ZIP', security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/uploads/image/presign':        { post: { tags: ['Uploads'], summary: 'Presigned PUT for an image', security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/uploads/image/confirm':        { post: { tags: ['Uploads'], summary: 'Confirm + attach uploaded image (Sharp variants)', security: bearer, responses: { 200: { description: 'OK' } } } },

  /* payments */
  '/api/payments/create-order':              { post: { tags: ['Payments'], summary: 'Create Zoho checkout session', security: bearer, responses: { 201: { description: 'paymentUrl + orderId' }, 400: responses[400] } } },
  '/api/payments/webhook':                   { post: { tags: ['Payments'], summary: 'Zoho webhook (HMAC-SHA256 verified)', responses: { 200: { description: 'Handled or ignored' }, 401: { description: 'Bad signature' } } } },
  '/api/payments/order/{id}/status':         { get: { tags: ['Payments'], security: bearer, summary: 'Order status (polled after redirect)', responses: { 200: { description: 'OK' }, 404: responses[404] } } },
  '/api/payments/order/{id}/cancel':         { post: { tags: ['Payments'], security: bearer, summary: 'Cancel pending order', responses: { 200: { description: 'Cancelled' }, 400: responses[400] } } },

  /* admin — summary only; full details live in the admin FE source */
  '/api/admin/dashboard/stats':       { get: { tags: ['Admin'], security: bearer, summary: 'Headline metrics', responses: { 200: { description: 'OK' } } } },
  '/api/admin/dashboard/revenue':     { get: { tags: ['Admin'], security: bearer, summary: '12-month revenue', responses: { 200: { description: 'OK' } } } },
  '/api/admin/dashboard/top-categories': { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/dashboard/recent-orders':  { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/products':      { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   post: { tags: ['Admin'], security: bearer, responses: { 201: { description: 'Created' } } } },
  '/api/admin/products/{id}': { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   put: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   delete: { tags: ['Admin'], security: bearer, responses: { 204: { description: 'Deleted' } } } },
  '/api/admin/products/bulk': { post: { tags: ['Admin'], security: bearer, summary: 'Bulk publish/unpublish/delete', responses: { 200: { description: 'OK' } } } },
  '/api/admin/bundles':       { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   post: { tags: ['Admin'], security: bearer, responses: { 201: { description: 'Created' } } } },
  '/api/admin/categories':    { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   post: { tags: ['Admin'], security: bearer, responses: { 201: { description: 'Created' } } } },
  '/api/admin/brands':        { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/blog':          { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/hero-slides':   { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/hero-slides/reorder': { put: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/users':         { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/users/{id}/status': { patch: { tags: ['Admin'], security: bearer, summary: 'Suspend / reactivate', responses: { 200: { description: 'OK' } } } },
  '/api/admin/orders':        { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/orders/{id}/status':  { patch: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/orders/{id}/refund':  { post:  { tags: ['Admin'], security: bearer, summary: 'Refund via Zoho + revoke download token', responses: { 200: { description: 'OK' } } } },
  '/api/admin/orders/{id}/resend-receipt': { post: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/settings':      { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } },
                                   put: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },
  '/api/admin/audit-log':     { get: { tags: ['Admin'], security: bearer, responses: { 200: { description: 'OK' } } } },

  /* observability */
  '/metrics': { get: { tags: ['Observability'], summary: 'Prometheus metrics', responses: { 200: { description: 'Plain text' } } } },
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Lexxus API',
    version: '1.0.0',
    description: [
      'REST API powering the Lexxus 3D digital products marketplace.',
      'Auth uses JWT access (15 min) + refresh (7 d) with rotation.',
      'Money is stored in rupees (INR); amounts sent to Zoho are converted to paise at the boundary.',
    ].join('\n\n'),
  },
  servers: [
    { url: env.API_URL || 'http://localhost:5050', description: env.NODE_ENV },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Products' },
    { name: 'Categories' },
    { name: 'Brands' },
    { name: 'Bundles' },
    { name: 'Blog' },
    { name: 'Home' },
    { name: 'Settings' },
    { name: 'Search' },
    { name: 'Misc' },
    { name: 'Cart' },
    { name: 'Wishlist' },
    { name: 'Users' },
    { name: 'Orders' },
    { name: 'Downloads' },
    { name: 'Reviews' },
    { name: 'Notifications' },
    { name: 'Uploads' },
    { name: 'Payments' },
    { name: 'Admin' },
    { name: 'Observability' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas,
  },
  paths,
};

module.exports = spec;
