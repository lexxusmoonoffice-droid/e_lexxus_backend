/**
 * Backblaze B2 (S3-compatible) wrapper.
 * Lazy client init so tests + dev work without B2 creds set; real
 * calls error clearly if creds are missing.
 *
 * Phase 6 only uses presigned URLs + HEAD/GET range, but the
 * complete read/write surface is exposed for later phases (image
 * variants, orphan sweep, admin uploads).
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const appConfig = require('./appConfig.service');

let client = null;
let clientFingerprint = null;

function fingerprint() {
  const c = appConfig.get('b2') || {};
  return [c.keyId, c.appKey, c.region, c.endpoint, c.bucketName].join('|');
}

function getClient() {
  const fp = fingerprint();
  if (client && fp === clientFingerprint) return client;
  const c = appConfig.get('b2') || {};
  if (!c.keyId || !c.appKey) {
    throw new Error('B2 credentials are not configured (set them in Admin → Settings → Storage)');
  }
  client = new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    credentials: { accessKeyId: c.keyId, secretAccessKey: c.appKey },
    forcePathStyle: false,
  });
  clientFingerprint = fp;
  return client;
}

/* For tests or after config reload: reset the cached client */
function _reset() {
  client = null;
  clientFingerprint = null;
}

const BUCKET = () => appConfig.get('b2.bucketName');

async function presignPutUrl({ key, contentType, expiresIn = 900, metadata = {} }) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
    Metadata: metadata,
    ServerSideEncryption: 'AES256',
  });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

async function presignGetUrl({ key, expiresIn = 300, attachment = false }) {
  const params = { Bucket: BUCKET(), Key: key };
  if (attachment) params.ResponseContentDisposition = 'attachment';
  const cmd = new GetObjectCommand(params);
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

async function headObject(key) {
  const res = await getClient().send(
    new HeadObjectCommand({ Bucket: BUCKET(), Key: key }),
  );
  return {
    sizeBytes: res.ContentLength,
    mimeType: res.ContentType,
    etag: (res.ETag || '').replace(/"/g, ''),
    lastModified: res.LastModified,
    metadata: res.Metadata || {},
  };
}

async function readRange(key, end) {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: BUCKET(), Key: key, Range: `bytes=0-${end}` }),
  );
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function putObject({ key, body, contentType }) {
  return getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function deleteObject(key) {
  return getClient().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

async function* listAll(prefix) {
  let token;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: BUCKET(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) yield obj;
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

module.exports = {
  getClient,
  presignPutUrl,
  presignGetUrl,
  headObject,
  readRange,
  putObject,
  deleteObject,
  listAll,
  _reset,
};
