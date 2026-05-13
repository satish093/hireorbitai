import pino from 'pino';
import { env } from './env';

/**
 * Structured logger. In development we pipe through `pino-pretty` for human
 * output; in production we emit JSON so log aggregators (Better Stack, Loki,
 * Grafana, etc.) can parse it.
 *
 * Add a `requestId` to log calls inside request handlers — `pino-http`
 * (mounted in server.ts) attaches one automatically to `req.log`.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.isProd ? 'info' : 'debug'),
  // Redact known-sensitive fields so we never leak tokens to logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.apiKey',
      '*.api_key',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  ...(env.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});
