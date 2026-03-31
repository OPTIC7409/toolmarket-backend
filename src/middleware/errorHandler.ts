import type { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation error', details: err.flatten() });
  }
  if (err instanceof Stripe.errors.StripeError) {
    const code = err.statusCode;
    const status =
      typeof code === 'number' && code >= 400 && code < 600 ? code : 502;
    console.error('[stripe]', err.type, err.code, err.message);
    return res.status(status).json({
      error: err.message,
      stripeType: err.type,
      stripeCode: err.code,
    });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
}
