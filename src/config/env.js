/**
 * Loads .env, validates with zod, exports a frozen `env` object.
 * Throws clearly on missing required vars in production.
 */

const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_NAME: z.string().default('Lexxus'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:3001'),
  API_URL: z.string().url().default('http://localhost:5000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  COOKIE_DOMAIN: z.string().optional().default(''),

  // Auth — required in prod, defaulted in dev/test for ergonomics
  JWT_ACCESS_SECRET: isProd
    ? z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars in production')
    : z.string().min(8).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: isProd
    ? z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars in production')
    : z.string().min(8).default('dev-refresh-secret-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  // Database
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/lexxus'),
  /** Comma-separated DNS IPs for SRV lookup (mongodb+srv). Helps when system DNS returns querySrv ECONNREFUSED. */
  MONGODB_DNS_SERVERS: z.string().optional().default(''),

  // Redis — optional in dev, required in prod
  REDIS_URL: isProd ? z.string().min(1) : z.string().optional().default(''),

  // Backblaze B2 — optional until Phase 6 (file uploads)
  B2_KEY_ID: z.string().optional().default(''),
  B2_APP_KEY: z.string().optional().default(''),
  B2_BUCKET_NAME: z.string().default('lexxus-files'),
  B2_REGION: z.string().default('us-east-005'),
  B2_ENDPOINT: z.string().default('https://s3.us-east-005.backblazeb2.com'),
  B2_ENDPOINT_HOST: z.string().default('s3.us-east-005.backblazeb2.com'),
  CDN_DOMAIN: z.string().default('files.lexxus.com'),

  // Cloudflare — optional
  CF_ACCOUNT_ID: z.string().optional().default(''),
  CF_API_TOKEN: z.string().optional().default(''),

  // Zoho Payments — optional until Phase 7
  ZOHO_CLIENT_ID: z.string().optional().default(''),
  ZOHO_CLIENT_SECRET: z.string().optional().default(''),
  ZOHO_REFRESH_TOKEN: z.string().optional().default(''),
  ZOHO_WEBHOOK_SECRET: z.string().optional().default(''),
  ZOHO_API_BASE: z.string().default('https://payments.zoho.in/api/v1'),

  // SMTP — optional until Phase 10
  SMTP_HOST: z.string().default('smtp.zoho.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(true),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Lexxus <no-reply@lexxus.com>'),

  // Misc
  DOWNLOAD_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DOWNLOAD_LIMIT_PER_ORDER: z.coerce.number().int().positive().default(5),
  DOWNLOAD_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
  GLOBAL_RATE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(300),
  SENTRY_DSN: z.string().optional().default(''),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),

  // Dev mock payments — set to "true" to skip Zoho and auto-mark orders paid
  PAYMENT_MOCK: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(false),
});

let parsed;
try {
  parsed = schema.parse(process.env);
} catch (err) {
  /* eslint-disable no-console */
  console.error('\n❌ Invalid environment configuration:');
  if (err.errors) {
    err.errors.forEach((e) => {
      console.error(`  • ${e.path.join('.')}: ${e.message}`);
    });
  } else {
    console.error(err);
  }
  console.error('\nFix the errors above (see backend/.env.example) and try again.\n');
  /* eslint-enable no-console */
  process.exit(1);
}

const env = Object.freeze({
  ...parsed,
  isProd: parsed.NODE_ENV === 'production',
  isDev: parsed.NODE_ENV === 'development',
  isTest: parsed.NODE_ENV === 'test',
  hasRedis: Boolean(parsed.REDIS_URL),
});

module.exports = env;
