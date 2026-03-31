import type { Request, Response, NextFunction } from 'express';
import type { Env } from '../config/env.js';
import type { AccessTokenPayload } from '../lib/jwt.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { HttpError } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import type { User, UserRole } from '@prisma/client';

export type AuthedRequest = Request & {
  auth?: AccessTokenPayload;
  user?: User;
};

export function authenticate(env: Env) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return next(new HttpError(401, 'Missing bearer token'));
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = verifyAccessToken(env.JWT_SECRET, token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return next(new HttpError(401, 'User not found'));
      r.auth = { sub: user.id, email: user.email, role: user.role };
      r.user = user;
      next();
    } catch {
      next(new HttpError(401, 'Invalid or expired token'));
    }
  };
}

export function optionalAuthenticate(env: Env) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const r = req as AuthedRequest;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = verifyAccessToken(env.JWT_SECRET, token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        r.auth = { sub: user.id, email: user.email, role: user.role };
        r.user = user;
      }
    } catch {
      // ignore
    }
    next();
  };
}

export function hasRole(userRole: UserRole, required: UserRole | UserRole[]): boolean {
  const need = Array.isArray(required) ? required : [required];
  // Routes that explicitly require the ADMIN role only.
  if (need.includes('ADMIN')) return userRole === 'ADMIN';
  // Platform admins may use seller/buyer APIs (e.g. create listings, support).
  if (userRole === 'ADMIN') return true;

  const satisfies = (r: UserRole): boolean => {
    if (r === 'BUYER') return userRole === 'BUYER' || userRole === 'BOTH';
    if (r === 'SELLER') return userRole === 'SELLER' || userRole === 'BOTH';
    return userRole === r;
  };

  return need.some(satisfies);
}
