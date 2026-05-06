const requestId = require('../../src/middleware/requestId');

describe('requestId middleware', () => {
  it('generates an id when none is provided', () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    requestId(req, res, next);
    expect(req.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.id);
    expect(next).toHaveBeenCalled();
  });

  it('honours an inbound x-request-id', () => {
    const req = { headers: { 'x-request-id': 'incoming-123' } };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    requestId(req, res, next);
    expect(req.id).toBe('incoming-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'incoming-123');
  });
});
