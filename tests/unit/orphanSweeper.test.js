jest.mock('../../src/services/b2', () => ({
  listAll: jest.fn(),
  deleteObject: jest.fn(async () => ({})),
}));

const { setupDB } = require('../helpers/db');
const f = require('../helpers/factories');
const b2 = require('../../src/services/b2');
const sweeper = require('../../src/jobs/orphanSweeper');
const { Product } = require('../../src/models');

setupDB();

async function* gen(items) {
  for (const it of items) yield it;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('orphanSweeper', () => {
  it('extractKey understands CDN, B2, and unrelated URLs', () => {
    process.env.NODE_ENV = 'test';
    expect(sweeper.extractKey('https://files.lexxus.com/products/u/abc/file.zip'))
      .toBe('products/u/abc/file.zip');
    expect(sweeper.extractKey('https://s3.us-east-005.backblazeb2.com/lexxus-files/products/u/abc/file.zip?x=y'))
      .toBe('products/u/abc/file.zip');
    expect(sweeper.extractKey('https://images.unsplash.com/foo.jpg')).toBeNull();
    expect(sweeper.extractKey(null)).toBeNull();
  });

  it('collectReferencedKeys gathers product file + thumbnails', async () => {
    const product = await f.makeProduct();
    product.file = {
      b2FileName: 'products/x/y/file.zip',
      cdnUrl: 'https://files.lexxus.com/products/x/y/file.zip',
    };
    product.thumbnail = 'https://files.lexxus.com/images/product/x/y/t.png';
    product.images = ['https://files.lexxus.com/images/product/x/y/g1.png'];
    await product.save();

    const keys = await sweeper.collectReferencedKeys();
    expect(keys.has('products/x/y/file.zip')).toBe(true);
    expect(keys.has('images/product/x/y/t.png')).toBe(true);
    expect(keys.has('images/product/x/y/g1.png')).toBe(true);
  });

  it('runOrphanSweep dry-run reports candidates without deleting', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const newDate = new Date();
    b2.listAll.mockImplementation(function listMock(prefix) {
      if (prefix === 'products/') {
        return gen([
          { Key: 'products/x/y/file.zip', LastModified: oldDate }, // referenced → skip
          { Key: 'products/orphan/abc/old.zip', LastModified: oldDate }, // orphan + old → candidate
          { Key: 'products/orphan/abc/new.zip', LastModified: newDate }, // orphan but young → skip
        ]);
      }
      return gen([]);
    });
    const product = await f.makeProduct();
    product.file = { b2FileName: 'products/x/y/file.zip' };
    await product.save();

    const summary = await sweeper.runOrphanSweep({ dryRun: true });
    expect(summary.scanned).toBe(3);
    expect(summary.candidates).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(b2.deleteObject).not.toHaveBeenCalled();
  });

  it('runOrphanSweep deletes orphans when not a dry run', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    b2.listAll.mockImplementation(function listMock(prefix) {
      if (prefix === 'products/') {
        return gen([{ Key: 'products/orphan/abc/old.zip', LastModified: oldDate }]);
      }
      return gen([]);
    });
    const summary = await sweeper.runOrphanSweep({ dryRun: false });
    expect(summary.deleted).toBe(1);
    expect(b2.deleteObject).toHaveBeenCalledWith('products/orphan/abc/old.zip');
  });
});
