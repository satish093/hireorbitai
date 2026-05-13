import { ErrorRequestHandler } from 'express';
import { ApiError } from '../types';
import { logger } from '../config/logger';
import { env } from '../config/env';

export const errorHandler: ErrorRequestHandler = (err: ApiError, req, res, _next) => {
  const status = err.status ?? 500;
  // pino-http attaches req.log per-request with a requestId. Falling back to
  // the shared logger preserves logging if errorHandler fires before pino-http
  // ran (rare — pre-route errors).
  const log = (req as unknown as { log?: typeof logger }).log ?? logger;
  if (status >= 500) {
    log.error({ err, status, path: req.path }, 'Unhandled API error');
  } else if (status >= 400) {
    log.warn({ status, message: err.message, path: req.path }, 'Client error');
  }
  res.status(status).json({
    error: err.message ?? 'Internal Server Error',
    // Never leak stack traces / arbitrary `details` to clients in production.
    ...(env.isProd ? {} : { details: err.details }),
  });
};
