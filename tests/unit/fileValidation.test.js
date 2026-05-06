const fv = require('../../src/utils/fileValidation');

describe('fileValidation', () => {
  it('isZip — detects PK magic bytes', () => {
    expect(fv.isZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(fv.isZip(Buffer.from([0x00, 0x00, 0x00, 0x00]))).toBe(false);
    expect(fv.isZip(null)).toBe(false);
    expect(fv.isZip(Buffer.alloc(2))).toBe(false);
  });

  it('isImage — detects JPEG / PNG / GIF / WebP', () => {
    expect(fv.isImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(fv.isImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(fv.isImage(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(fv.isImage(webp)).toBe('image/webp');
    expect(fv.isImage(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe(null);
  });

  it('assertZipMime / assertImageMime', () => {
    expect(() => fv.assertZipMime('application/zip')).not.toThrow();
    expect(() => fv.assertZipMime('text/plain')).toThrow();
    expect(() => fv.assertImageMime('image/jpeg')).not.toThrow();
    expect(() => fv.assertImageMime('text/html')).toThrow();
  });

  it('assertSize enforces max', () => {
    expect(() => fv.assertSize(100, 1000)).not.toThrow();
    expect(() => fv.assertSize(2000, 1000)).toThrow();
    expect(() => fv.assertSize(0, 1000)).toThrow();
    expect(() => fv.assertSize('big', 1000)).toThrow();
  });
});
