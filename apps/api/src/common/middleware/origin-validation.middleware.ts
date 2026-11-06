
import type { RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createOriginValidationMiddleware(
  allowedOrigins: string[],
): RequestHandler {
  const allowed = new Set(
    allowedOrigins
      .filter(Boolean)
      .map((origin) => new URL(origin).origin),
  );

  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    const origin = req.get('origin');

    if (!origin || origin === 'null') {
      return res.status(403).json({
        statusCode: 403,
        message: 'Forbidden: missing or invalid request origin',
      });
    }

    let normalizedOrigin: string;

    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      return res.status(403).json({
        statusCode: 403,
        message: 'Forbidden: missing or invalid request origin',
      });
    }

    if (!allowed.has(normalizedOrigin)) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Forbidden: untrusted request origin',
      });
    }

    next();
  };
}
