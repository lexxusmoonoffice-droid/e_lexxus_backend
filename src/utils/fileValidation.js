/**
 * Centralised file constraints — MIME types, size caps, magic bytes.
 * All input is suspect; check both the declared MIME *and* the actual
 * file signature before persisting metadata.
 */

const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

const ZIP_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'multipart/x-zip',
]);

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Each entry: array of byte arrays (alternative magic numbers). */
const SIGNATURES = {
  zip: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06], // empty archive
    [0x50, 0x4b, 0x07, 0x08], // spanned
  ],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF8
  // WebP: 'RIFF' .... 'WEBP' — checked separately below.
};

function startsWith(buf, sig) {
  if (!buf || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

function matchesAny(buf, sigs) {
  return sigs.some((sig) => startsWith(buf, sig));
}

function isZip(buf) {
  return matchesAny(buf, SIGNATURES.zip);
}

function isImage(buf) {
  if (matchesAny(buf, SIGNATURES.jpeg)) return 'image/jpeg';
  if (matchesAny(buf, SIGNATURES.png)) return 'image/png';
  if (matchesAny(buf, SIGNATURES.gif)) return 'image/gif';
  // WebP: bytes 0..3 = 'RIFF', bytes 8..11 = 'WEBP'
  if (
    buf &&
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function assertZipMime(mime) {
  if (!ZIP_MIMES.has(mime)) {
    const err = new Error('Only ZIP files are allowed');
    err.code = 'BAD_MIME';
    throw err;
  }
}

function assertImageMime(mime) {
  if (!IMAGE_MIMES.has(mime)) {
    const err = new Error('Only JPEG/PNG/WebP/GIF images are allowed');
    err.code = 'BAD_MIME';
    throw err;
  }
}

function assertSize(bytes, max) {
  if (typeof bytes !== 'number' || bytes <= 0 || bytes > max) {
    const err = new Error(`File too large (max ${max} bytes)`);
    err.code = 'TOO_LARGE';
    throw err;
  }
}

module.exports = {
  MAX_ZIP_BYTES,
  MAX_IMAGE_BYTES,
  ZIP_MIMES,
  IMAGE_MIMES,
  isZip,
  isImage,
  assertZipMime,
  assertImageMime,
  assertSize,
};
