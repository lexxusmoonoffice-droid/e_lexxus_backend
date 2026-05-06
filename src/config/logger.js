/**
 * Winston logger — JSON logs in prod, pretty colourised in dev.
 * Daily rotated file under logs/ in non-test environments.
 * Re-exports a Morgan stream for HTTP logging.
 */

const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const env = require('./env');

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, requestId, stack, ...meta }) => {
    const reqPart = requestId ? ` [req=${requestId}]` : '';
    const metaPart = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    // Only print stack for actual errors, not for warn-level handled cases (404s etc.)
    const showStack = stack && (level.includes('error') || process.env.LOG_STACKS === '1');
    const stackPart = showStack ? `\n${stack}` : '';
    return `${ts} ${level}${reqPart} ${message}${metaPart}${stackPart}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const transports = [new winston.transports.Console({ handleExceptions: true, silent: env.isTest })];

if (!env.isTest) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(__dirname, '../../logs/lexxus-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  );
}

const logger = winston.createLogger({
  level: env.isTest ? 'error' : env.LOG_LEVEL,
  format: env.isProd ? prodFormat : devFormat,
  transports,
  exitOnError: false,
});

logger.stream = {
  write: (msg) => logger.http ? logger.http(msg.trim()) : logger.info(msg.trim()),
};

module.exports = logger;
