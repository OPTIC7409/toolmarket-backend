import { Router, type Request, type Response, type NextFunction } from 'express';
import Stripe from 'stripe';
import { StripeAccountStatus, PurchaseStatus, PayoutStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { createStripeClient } from '../lib/stripe.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import type { Env } from '../config/env.js';

function mapAccountStatus(account: Stripe.Account): StripeAccountStatus {
  if (account.requirements?.disabled_reason) return StripeAccountStatus.RESTRICTED;
  if (account.charges_enabled && account.payouts_enabled) return StripeAccountStatus.ACTIVE;
  return StripeAccountStatus.PENDING;
}

export function stripeWebhookMiddleware(env: Env, stripe: Stripe) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!env.STRIPE_WEBHOOK_SECRET) {
        throw new HttpError(500, 'STRIPE_WEBHOOK_SECRET is not configured');
      }
      const sig = req.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') throw new HttpError(400, 'Missing stripe-signature');

      const rawBody = req.body;
      if (!Buffer.isBuffer(rawBody)) {
        throw new HttpError(400, 'Webhook body must be raw');
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        throw new HttpError(400, `Webhook signature verification failed: ${String(err)}`);
      }

      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object as Stripe.PaymentIntent;
          const purchaseId = pi.metadata?.purchaseId;
          if (!purchaseId) break;
          const holdUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const purchase = await prisma.purchase.update({
            where: { id: purchaseId },
            data: {
              status: PurchaseStatus.COMPLETED,
              payoutScheduledAt: holdUntil,
              payoutStatus: PayoutStatus.HOLDING,
              payoutPaused: false,
            },
            include: { listing: true },
          });
          await prisma.listing.update({
            where: { id: purchase.listingId },
            data: { purchaseCount: { increment: 1 } },
          });
          await prisma.sellerProfile.update({
            where: { id: purchase.sellerId },
            data: {
              totalSales: { increment: 1 },
              totalRevenue: { increment: purchase.sellerPayout },
            },
          });
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object as Stripe.PaymentIntent;
          const purchaseId = pi.metadata?.purchaseId;
          if (!purchaseId) break;
          await prisma.purchase.updateMany({
            where: { id: purchaseId, status: PurchaseStatus.PENDING },
            data: { status: PurchaseStatus.FAILED },
          });
          break;
        }
        case 'transfer.created': {
          const tr = event.data.object as Stripe.Transfer;
          const purchaseId = tr.metadata?.purchaseId;
          if (!purchaseId) break;
          await prisma.purchase.updateMany({
            where: { id: purchaseId },
            data: {
              stripeTransferId: tr.id,
              payoutStatus: PayoutStatus.PAID,
            },
          });
          break;
        }
        default:
          break;
      }

      return res.json({ received: true });
    } catch (e) {
      next(e);
    }
  };
}

export function createStripeConnectRouter(env: Env, stripe: Stripe) {
  const router = Router();

  router.post('/connect/create-account', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      if (!profile) throw new HttpError(400, 'Seller profile missing');
      if (profile.stripeAccountId) {
        return res.json({ accountId: profile.stripeAccountId, existing: true });
      }
      const account = await stripe.accounts.create({
        type: 'express',
        country: env.STRIPE_CONNECT_COUNTRY,
        email: r.user!.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { sellerProfileId: profile.id },
      });
      await prisma.sellerProfile.update({
        where: { id: profile.id },
        data: {
          stripeAccountId: account.id,
          stripeAccountStatus: mapAccountStatus(account),
        },
      });
      return res.status(201).json({ accountId: account.id });
    } catch (e) {
      next(e);
    }
  });

  router.post('/connect/create-onboarding-link', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      if (!profile?.stripeAccountId) throw new HttpError(400, 'Create a Connect account first');
      const link = await stripe.accountLinks.create({
        account: profile.stripeAccountId,
        refresh_url: `${env.FRONTEND_URL}/onboarding/seller`,
        return_url: `${env.FRONTEND_URL}/dashboard/seller`,
        type: 'account_onboarding',
      });
      return res.json({ url: link.url });
    } catch (e) {
      next(e);
    }
  });

  router.get('/connect/account-status', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      if (!profile?.stripeAccountId) throw new HttpError(400, 'Stripe account not linked');
      const account = await stripe.accounts.retrieve(profile.stripeAccountId);
      const status = mapAccountStatus(account);
      await prisma.sellerProfile.update({
        where: { id: profile.id },
        data: { stripeAccountStatus: status },
      });
      return res.json({
        status,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirements: account.requirements,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export function createStripeForEnv(env: Env) {
  return createStripeClient(env);
}
