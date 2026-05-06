const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  it('forwards async rejections to next()', async () => {
    const err = new Error('boom');
    const next = jest.fn();
    const wrapped = asyncHandler(async () => {
      throw err;
    });
    await wrapped({}, {}, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  it('does not call next on success', async () => {
    const next = jest.fn();
    const wrapped = asyncHandler(async (req, res) => {
      res.sent = true;
    });
    const res = {};
    await wrapped({}, res, next);
    expect(res.sent).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
