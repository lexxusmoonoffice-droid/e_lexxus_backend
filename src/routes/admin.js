const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const v = require('../validators/admin.validator');

const dashboard = require('../controllers/admin/dashboard.controller');
const products = require('../controllers/admin/products.controller');
const bundles = require('../controllers/admin/bundles.controller');
const categories = require('../controllers/admin/categories.controller');
const brands = require('../controllers/admin/brands.controller');
const blog = require('../controllers/admin/blog.controller');
const heroSlides = require('../controllers/admin/heroSlides.controller');
const users = require('../controllers/admin/users.controller');
const orders = require('../controllers/admin/orders.controller');
const reviewsAdmin = require('../controllers/admin/reviews.controller');
const settings = require('../controllers/admin/settings.controller');
const auditCtrl = require('../controllers/admin/audit.controller');

const router = express.Router();

// Every route under /api/admin/* requires an admin bearer.
router.use(requireAuth, requireAdmin);

/* Dashboard */
router.get('/dashboard/stats', dashboard.stats);
router.get('/dashboard/revenue', dashboard.revenue);
router.get('/dashboard/top-categories', dashboard.topCategories);
router.get('/dashboard/recent-orders', dashboard.recentOrders);

/* Products */
router.get('/products', validate(v.listQuery, 'query'), products.list);
router.post('/products', validate(v.productCreate), products.create);
router.post('/products/bulk', validate(v.productBulk), products.bulk);
router.get('/products/:id', validate(v.idParam, 'params'), products.detail);
router.put('/products/:id', validate(v.idParam, 'params'), validate(v.productUpdate), products.update);
router.patch('/products/:id/status', validate(v.idParam, 'params'), validate(v.productStatusPatch), products.patchStatus);
router.delete('/products/:id', validate(v.idParam, 'params'), products.remove);

/* Bundles */
router.get('/bundles', validate(v.listQuery, 'query'), bundles.list);
router.post('/bundles', validate(v.bundleCreate), bundles.create);
router.get('/bundles/:id', validate(v.idParam, 'params'), bundles.detail);
router.put('/bundles/:id', validate(v.idParam, 'params'), validate(v.bundleUpdate), bundles.update);
router.delete('/bundles/:id', validate(v.idParam, 'params'), bundles.remove);

/* Categories */
router.get('/categories', validate(v.listQuery, 'query'), categories.list);
router.post('/categories', validate(v.categoryUpsert), categories.create);
router.get('/categories/:id', validate(v.idParam, 'params'), categories.detail);
router.put('/categories/:id', validate(v.idParam, 'params'), validate(v.categoryUpsert.partial()), categories.update);
router.delete('/categories/:id', validate(v.idParam, 'params'), categories.remove);

/* Brands */
router.get('/brands', validate(v.listQuery, 'query'), brands.list);
router.post('/brands', validate(v.brandUpsert), brands.create);
router.get('/brands/:id', validate(v.idParam, 'params'), brands.detail);
router.put('/brands/:id', validate(v.idParam, 'params'), validate(v.brandUpsert.partial()), brands.update);
router.delete('/brands/:id', validate(v.idParam, 'params'), brands.remove);

/* Blog */
router.get('/blog', validate(v.listQuery, 'query'), blog.list);
router.post('/blog', validate(v.blogUpsert), blog.create);
router.get('/blog/:id', validate(v.idParam, 'params'), blog.detail);
router.put('/blog/:id', validate(v.idParam, 'params'), validate(v.blogUpsert.partial()), blog.update);
router.delete('/blog/:id', validate(v.idParam, 'params'), blog.remove);

/* Hero slides */
router.get('/hero-slides', heroSlides.list);
router.post('/hero-slides', validate(v.heroUpsert), heroSlides.create);
router.put('/hero-slides/reorder', validate(v.heroReorder), heroSlides.reorder);
router.get('/hero-slides/:id', validate(v.idParam, 'params'), heroSlides.detail);
router.put('/hero-slides/:id', validate(v.idParam, 'params'), validate(v.heroUpsert.partial()), heroSlides.update);
router.patch('/hero-slides/:id/toggle', validate(v.idParam, 'params'), heroSlides.toggle);
router.delete('/hero-slides/:id', validate(v.idParam, 'params'), heroSlides.remove);

/* Users */
router.get('/users', validate(v.listQuery, 'query'), users.list);
router.get('/users/:id', validate(v.idParam, 'params'), users.detail);
router.patch('/users/:id/status', validate(v.idParam, 'params'), validate(v.userStatusPatch), users.patchStatus);
router.get('/users/:id/orders', validate(v.idParam, 'params'), users.ordersForUser);

/* Orders */
router.get('/orders', validate(v.listQuery, 'query'), orders.list);
router.post('/orders', orders.create);
router.get('/orders/:id', validate(v.idParam, 'params'), orders.detail);
router.patch('/orders/:id/status', validate(v.idParam, 'params'), validate(v.orderStatusPatch), orders.patchStatus);
router.post('/orders/:id/refund', validate(v.idParam, 'params'), validate(v.orderRefund), orders.refund);
router.post('/orders/:id/resend-receipt', validate(v.idParam, 'params'), orders.resendReceipt);

/* Reviews — moderation */
router.get('/reviews', validate(v.listQuery, 'query'), reviewsAdmin.list);
router.patch('/reviews/:id/status', validate(v.idParam, 'params'), reviewsAdmin.patchStatus);
router.delete('/reviews/:id', validate(v.idParam, 'params'), reviewsAdmin.remove);

/* Settings */
router.get('/settings', settings.get);
router.put('/settings', validate(v.settingsUpdate), settings.update);

/* Audit log */
router.get('/audit-log', auditCtrl.list);

module.exports = router;
