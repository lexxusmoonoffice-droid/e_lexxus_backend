/**
 * Mailer — thin wrapper over nodemailer.
 * In dev/test (no SMTP_USER) it logs the email instead of sending.
 * Phase 10 wires real templates + BullMQ retry queue.
 */

const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../config/logger');
const appConfig = require('./appConfig.service');

let transporter = null;
let transporterFingerprint = null;

function fingerprint(s) {
  return [s.host, s.port, s.secure, s.user, s.pass].join('|');
}

function getTransporter() {
  const s = appConfig.get('smtp') || {};
  if (!s.user || !s.pass) return null; // log-only mode
  const fp = fingerprint(s);
  if (transporter && fp === transporterFingerprint) return transporter;
  transporter = nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 465,
    secure: !!s.secure,
    auth: { user: s.user, pass: s.pass },
  });
  transporterFingerprint = fp;
  return transporter;
}

function _reset() { transporter = null; transporterFingerprint = null; }

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  const mailFrom = appConfig.get('smtp.mailFrom') || '"Lexxus" <no-reply@lexxus.com>';
  const payload = { from: mailFrom, to, subject, html, text: text || stripHtml(html || '') };

  if (!t) {
    if (!env.isTest) {
      logger.info(`mail (log-only): "${subject}" → ${to}`, { preview: payload.text.slice(0, 200) });
    }
    return { messageId: 'log-only', accepted: [to], envelope: payload };
  }
  return t.sendMail(payload);
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = { sendMail, _reset };
