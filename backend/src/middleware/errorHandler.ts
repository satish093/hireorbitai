import { ErrorRequestHandler } from 'express';
import { MulterError } from 'multer';
import { ApiError } from '../types';
import { logger } from '../config/logger';
import { env } from '../config/env';

export const errorHandler: ErrorRequestHandler = (err: ApiError, req, res, _next) => {
  // Multer rejections (size limits, fileFilter rejections) come through as
  // MulterError or plain Error from the filter. Translate to a clean 400
  // so the upload UI shows the actual reason instead of a generic 500.
  let status = err.status ?? 500;
  let message = err.message ?? 'Internal Server Error';

  // Upstream API errors (Anthropic, Gemini, etc.) can carry 401/403 status
  // codes that mean "bad API key" — not "user not authenticated". Passing them
  // through would trigger the frontend's auth-redirect interceptor. Remap to
  // 502 so the client sees a server-side failure, not an auth failure.
  if ((status === 401 || status === 403) && !(err as any).isHttpError) {
    status = 502;
    message = 'AI service error — check the API key configuration on the server.';
  }

  if (err instanceof MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'File is too large.';
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = 'Unexpected file field.';
    else message = err.message;
  } else if (err.message?.startsWith('File type not allowed')) {
    status = 400;
  }

  // pino-http attaches req.log per-request with a requestId. Falling back to
  // the shared logger preserves logging if errorHandler fires before pino-http
  // ran (rare — pre-route errors).
  const log = (req as unknown as { log?: typeof logger }).log ?? logger;
  if (status >= 500) {
    log.error({ err, status, path: req.path }, 'Unhandled API error');
  } else if (status >= 400) {
    log.warn({ status, message, path: req.path }, 'Client error');
  }
  res.status(status).json({
    error: message,
    // Never leak stack traces / arbitrary `details` to clients in production.
    ...(env.isProd ? {} : { details: err.details }),
  });
};
