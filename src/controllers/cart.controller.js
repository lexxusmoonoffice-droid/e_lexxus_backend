const asyncHandler = require('../utils/asyncHandler');
const cartService = require('../services/cart.service');

const get = asyncHandler(async (req, res) => {
  const cart = await cartService.loadCart(req.user._id);
  res.json({ cart });
});

const add = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user._id, req.body);
  res.status(201).json({ cart });
});

const update = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItem(req.user._id, {
    type: req.params.type,
    id: req.params.id,
    qty: req.body.qty,
  });
  res.json({ cart });
});

const remove = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user._id, {
    type: req.params.type,
    id: req.params.id,
  });
  res.json({ cart });
});

const clear = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user._id);
  res.json({ cart });
});

const merge = asyncHandler(async (req, res) => {
  const cart = await cartService.mergeCart(req.user._id, req.body.items);
  res.json({ cart });
});

module.exports = { get, add, update, remove, clear, merge };
