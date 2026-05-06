/**
 * Email queue (BullMQ).
 *
 *   enqueueEmail({ template, to, data })
 *
 * Behaviour:
 *   - If Redis is configured, pushes a job onto `email` queue with
 *     exponential-backoff retries (5 attempts) + dead-letter (failed
 *     jobs stay on the queue for inspection).
 *   - If Redis is not configured, renders + sends the email
 *     synchronously (fire-and-forget on the caller's side).
 *   - Under NODE_ENV=test, always sends synchronously so tests don't
 *     need a Redis instance.
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const env = require('../config/env');
const logger = require('../config/logger');
const { getRedis } = require('../config/redis');
const { render } = require('../templates/email');
const { sendMail } = require('../services/mailer.service');

const QUEUE_NAME = 'email';
let queue = null;
let worker = null;

function connection() {
  const r = getRedis();
  if (!r) return null;
  // BullMQ wants a Redis connection or a config — reuse our client.
  return { connection: r };
}

function getQueue() {
  if (queue || env.isTest || !env.hasRedis) return queue;
  const conn = connection();
  if (!conn) return null;
  queue = new Queue(QUEUE_NAME, conn);
  return queue;
}

async function renderAndSend({ template, to, data }) {
  const payload = render(template, { appName: env.APP_NAME, ...data });
  return sendMail({ to, subject: payload.subject, html: payload.html });
}

async function enqueueEmail({ template, to, data }) {
  // In test + no-Redis dev, go synchronous.
  if (env.isTest || !env.hasRedis) {
    try {
      await renderAndSend({ template, to, data });
    } catch (err) {
      logger.error('email send (sync) failed', { template, to, message: err.message });
    }
    return { mode: 'sync' };
  }
  const q = getQueue();
  if (!q) {
    await renderAndSend({ template, to, data });
    return { mode: 'sync-fallback' };
  }
  await q.add(
    template,
    { template, to, data },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: false,
    },
  );
  return { mode: 'queued' };
}

/** Boot the worker — called from server.js on process start. */
function startWorker() {
  if (env.isTest || !env.hasRedis) return null;
  const conn = connection();
  if (!conn) return null;
  worker = new Worker(QUEUE_NAME, async (job) => renderAndSend(job.data), conn);
  worker.on('completed', (job) =>
    logger.info('email sent', { id: job.id, template: job.data.template, to: job.data.to }),
  );
  worker.on('failed', (job, err) =>
    logger.error('email job failed', {
      id: job?.id,
      template: job?.data?.template,
      to: job?.data?.to,
      attemptsMade: job?.attemptsMade,
      message: err.message,
    }),
  );
  return worker;
}

async function close() {
  try {
    if (worker) await worker.close();
  } catch {
    /* ignore */
  }
  try {
    if (queue) await queue.close();
  } catch {
    /* ignore */
  }
  worker = null;
  queue = null;
}

module.exports = { enqueueEmail, startWorker, close, QUEUE_NAME };
