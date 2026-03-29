import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Env } from './config/env.js';
import { corsOriginList } from './config/env.js';
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

export function createApp(env: Env) {
  const app = express();
  const stripe = createStripeClient(env);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOriginList(env),
      credentials: true,
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
  });

  app.use(publicLimiter);

  app.use(express.json({ limit: '1mb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/auth', authLimiter, createAuthRouter(env));
  app.use('/listings', createListingsRouter(env));
  app.use('/checkout', createCheckoutRouter(env, stripe));
  app.use('/stripe', createStripeConnectRouter(env, stripe));
  app.use('/buyer', createBuyerRouter(env));
  app.use('/seller', createSellerRouter(env));
  app.use('/admin', createAdminRouter(env, stripe));
  app.use(createMiscRouter(env));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);

  return app;
}
