import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

const DEFAULT_EXPIRES_SEC = 60 * 60 * 24 * 7;

export function signAccessToken(secret: string, payload: AccessTokenPayload, expiresInSec = DEFAULT_EXPIRES_SEC): string {
  return jwt.sign(
    {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    },
    secret,
    { algorithm: 'HS256', expiresIn: expiresInSec }
  );
}

export function verifyAccessToken(secret: string, token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded || typeof decoded !== 'object') {
    throw new Error('Invalid token payload');
  }
  const rec = decoded as Record<string, unknown>;
  const sub = rec.sub;
  const email = rec.email;
  const role = rec.role;
  if (typeof sub !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid token claims');
  }
  return { sub, email, role: role as UserRole };
}
