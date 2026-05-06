const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const { HeroSlide } = require('../../models');
const audit = require('../../services/audit.service');
const invalidate = require('../../services/invalidation.service');

const list = asyncHandler(async (req, res) => {
  const slides = await HeroSlide.find({}).sort('order createdAt');
  res.json({ data: slides });
});

const detail = asyncHandler(async (req, res) => {
  const s = await HeroSlide.findById(req.params.id);
  if (!s) throw AppError.notFound('Slide not found');
  res.json({ slide: s });
});

const create = asyncHandler(async (req, res) => {
  const slide = await HeroSlide.create(req.body);
  await audit.logAction(req, 'hero.create', 'HeroSlide', slide._id, { after: slide.toJSON() });
  await invalidate.heroSlides();
  res.status(201).json({ slide });
});

const update = asyncHandler(async (req, res) => {
  const before = await HeroSlide.findById(req.params.id);
  if (!before) throw AppError.notFound('Slide not found');
  const slide = await HeroSlide.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  await audit.logAction(req, 'hero.update', 'HeroSlide', slide._id, { before: before.toJSON(), after: slide.toJSON() });
  await invalidate.heroSlides();
  res.json({ slide });
});

const remove = asyncHandler(async (req, res) => {
  const slide = await HeroSlide.findByIdAndDelete(req.params.id);
  if (!slide) throw AppError.notFound('Slide not found');
  await audit.logAction(req, 'hero.delete', 'HeroSlide', slide._id, { before: slide.toJSON() });
  await invalidate.heroSlides();
  res.status(204).end();
});

const toggle = asyncHandler(async (req, res) => {
  const slide = await HeroSlide.findById(req.params.id);
  if (!slide) throw AppError.notFound('Slide not found');
  slide.active = !slide.active;
  await slide.save();
  await audit.logAction(req, 'hero.toggle', 'HeroSlide', slide._id, { after: { active: slide.active } });
  await invalidate.heroSlides();
  res.json({ slide });
});

const reorder = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const ops = ids.map((id, i) => ({
    updateOne: { filter: { _id: id }, update: { $set: { order: i } } },
  }));
  await HeroSlide.bulkWrite(ops);
  await audit.logAction(req, 'hero.reorder', 'HeroSlide', null, { after: { ids } });
  await invalidate.heroSlides();
  const slides = await HeroSlide.find({}).sort('order createdAt');
  res.json({ data: slides });
});

module.exports = { list, detail, create, update, remove, toggle, reorder };
