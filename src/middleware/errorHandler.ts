import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../lib/httpError.js';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation error', details: err.flatten() });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
}
