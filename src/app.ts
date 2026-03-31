import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Env } from './config/env.js';
import { corsOriginList, isDevLocalhostOrigin } from './config/env.js';
import { createStripeClient } from './lib/stripe.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createAuthRouter } from './routes/auth.js';
import { createListingsRouter } from './routes/listings.js';
import { createCheckoutRouter } from './routes/checkout.js';
import { createStripeConnectRouter, stripeWebhookMiddleware } from './routes/stripeConnect.js';
import { createBuyerRouter } from './routes/buyer.js';
import { createSellerRouter } from './routes/seller.js';
import { createAdminRouter } from './routes/admin.js';
import { createMiscRouter } from './routes/misc.js';
import { createMessagesRouter } from './routes/messages.js';

export function createApp(env: Env) {
  const app = express();
  const stripe = createStripeClient(env);

  const allowedOrigins = corsOriginList(env);
  if (env.NODE_ENV === 'development') {
    console.log('[cors] allowed origins:', allowedOrigins.join(', ') || '(none)');
  }

  // Explicit CORS (no `cors` package): preflight must return ACAO + credentials; the
  // `cors` middleware’s dynamic-origin path can omit ACAO when headers don’t line up.
  app.use((req, res, next) => {
    const method = (req.method ?? '').toUpperCase();
    const origin = req.headers.origin;
    if (!origin || typeof origin !== 'string') {
      next();
      return;
    }
    const allow =
      allowedOrigins.includes(origin) ||
      (env.NODE_ENV === 'development' && isDevLocalhostOrigin(origin));
    if (!allow) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (method === 'OPTIONS') {
      const reqHdrs = req.headers['access-control-request-headers'];
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        typeof reqHdrs === 'string' ? reqHdrs : 'Content-Type, Authorization'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      if (env.NODE_ENV === 'development') {
        res.setHeader('X-Toolmarket-Cors', 'manual-preflight');
      }
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.post(
    '/stripe/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhookMiddleware(env, stripe)
  );

  const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
  });

  app.use(publicLimiter);

  app.use(express.json({ limit: '1mb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
  });

  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === 'production' ? 120 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    message: { error: 'Too many admin requests — slow down.' },
  });

  app.use('/auth', authLimiter, createAuthRouter(env));
  app.use('/listings', createListingsRouter(env));
  app.use('/checkout', createCheckoutRouter(env, stripe));
  app.use('/stripe', createStripeConnectRouter(env, stripe));
  app.use('/buyer', createBuyerRouter(env));
  app.use('/seller', createSellerRouter(env));
  app.use('/messages', createMessagesRouter(env));
  app.use('/admin', adminLimiter, createAdminRouter(env, stripe));
  app.use(createMiscRouter(env));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);

  return app;
}
