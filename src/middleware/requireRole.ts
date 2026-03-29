import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '@prisma/client';
import { HttpError } from '../lib/httpError.js';
import { hasRole, type AuthedRequest } from './authenticate.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    if (!r.user || !r.auth) return next(new HttpError(401, 'Unauthorized'));
    if (!hasRole(r.user.role, roles)) {
      return next(new HttpError(403, 'Insufficient permissions'));
    }
    next();
  };
}
