import { Router } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signAccessToken } from '../lib/jwt.js';
import { HttpError } from '../lib/httpError.js';
import { ensureUniqueSellerSlug } from '../lib/sellerProfile.js';
import { validateBody } from '../middleware/validateBody.js';
import { registerSchema, loginSchema } from '../validation/schemas.js';
import type { LoginInput, RegisterInput } from '../validation/schemas.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import type { Env } from '../config/env.js';

function mapRegisterRole(role: string): Exclude<UserRole, 'ADMIN'> {
  if (role === 'seller') return 'SELLER';
  if (role === 'both') return 'BOTH';
  return 'BUYER';
}

export function createAuthRouter(env: Env) {
  const router = Router();

  router.post('/register', validateBody(registerSchema), async (req, res, next) => {
    try {
      const { name, email, password, role: roleInput, businessName, bio } = req.body as RegisterInput;
      const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (exists) throw new HttpError(409, 'Email already registered');

      const passwordHash = await hashPassword(password);
      let role: UserRole =
        env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
          ? 'ADMIN'
          : mapRegisterRole(roleInput);

      const user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            name,
            email: email.toLowerCase(),
            passwordHash,
            role,
          },
        });

        if (role === 'SELLER' || role === 'BOTH') {
          const baseForSlug = businessName?.trim() ? businessName : name;
          const slug = await ensureUniqueSellerSlug(tx, baseForSlug);
          await tx.sellerProfile.create({
            data: {
              userId: u.id,
              slug,
              commissionRate: 0.15,
              bio: bio ?? null,
              businessName: businessName ?? null,
            },
          });
        }

        return u;
      });

      const token = signAccessToken(env.JWT_SECRET, {
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/login', validateBody(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.body as LoginInput;
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user) throw new HttpError(401, 'Invalid email or password');
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) throw new HttpError(401, 'Invalid email or password');

      const token = signAccessToken(env.JWT_SECRET, {
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/me', authenticate(env), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const user = r.user!;
      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { userId: user.id },
      });
      return res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
        sellerProfile,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/upgrade-to-seller', authenticate(env), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const user = r.user!;
      if (user.role === 'ADMIN') throw new HttpError(400, 'Admins use separate seller accounts');
      if (user.role === 'SELLER' || user.role === 'BOTH') {
        const existing = await prisma.sellerProfile.findUnique({ where: { userId: user.id } });
        const token = signAccessToken(env.JWT_SECRET, {
          sub: user.id,
          email: user.email,
          role: user.role,
        });
        return res.json({ ok: true, token, role: user.role, sellerProfile: existing });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: user.id },
          data: { role: 'BOTH' },
        });
        const has = await tx.sellerProfile.findUnique({ where: { userId: u.id } });
        let profile = has;
        if (!has) {
          const slug = await ensureUniqueSellerSlug(tx, u.name);
          profile = await tx.sellerProfile.create({
            data: {
              userId: u.id,
              slug,
              commissionRate: 0.15,
            },
          });
        }
        return { user: u, sellerProfile: profile };
      });

      const token = signAccessToken(env.JWT_SECRET, {
        sub: updated.user.id,
        email: updated.user.email,
        role: updated.user.role,
      });

      return res.json({ token, user: updated.user, sellerProfile: updated.sellerProfile });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
