const asyncHandler = require('../utils/asyncHandler');
const wishlistService = require('../services/wishlist.service');

const get = asyncHandler(async (req, res) => {
  res.json({ wishlist: await wishlistService.load(req.user._id) });
});

const add = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.add(req.user._id, req.body);
  res.status(201).json({ wishlist });
});

const remove = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.remove(req.user._id, {
    type: req.params.type,
    id: req.params.id,
  });
  res.json({ wishlist });
});

module.exports = { get, add, remove };
