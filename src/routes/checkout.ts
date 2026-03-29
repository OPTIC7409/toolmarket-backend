import { Router } from 'express';
import { ListingStatus, PurchaseStatus, PayoutStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import type Stripe from 'stripe';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateBody } from '../middleware/validateBody.js';
import { createPaymentIntentSchema } from '../validation/schemas.js';
import { transferPurchaseToSeller } from '../services/payouts.js';
import { singleParam } from '../lib/routeParams.js';
import type { Env } from '../config/env.js';

export function createCheckoutRouter(env: Env, stripe: Stripe) {
  const router = Router();

  router.post(
    '/create-payment-intent',
    authenticate(env),
    requireRole('BUYER'),
    validateBody(createPaymentIntentSchema),
    async (req, res, next) => {
      try {
        const { listingId } = req.body as { listingId: string };
        const r = req as AuthedRequest;
        const buyer = r.user!;

        const listing = await prisma.listing.findUnique({
          where: { id: listingId },
          include: { seller: true },
        });
        if (!listing || listing.status !== ListingStatus.LIVE) {
          throw new HttpError(400, 'Listing is not available');
        }

        const amount = Number(listing.price);
        const rate = listing.seller.commissionRate;
        const platformFee = Math.round((amount * rate + Number.EPSILON) * 100) / 100;
        const sellerPayout = Math.round((amount - platformFee + Number.EPSILON) * 100) / 100;

        let stripeCustomerId = buyer.stripeCustomerId;
        if (!stripeCustomerId) {
          const customer = await stripe.customers.create({
            email: buyer.email,
            name: buyer.name,
            metadata: { userId: buyer.id },
          });
          stripeCustomerId = customer.id;
          await prisma.user.update({
            where: { id: buyer.id },
            data: { stripeCustomerId },
          });
        }

        const purchase = await prisma.purchase.create({
          data: {
            buyerId: buyer.id,
            listingId: listing.id,
            sellerId: listing.sellerId,
            amount,
            platformFee,
            sellerPayout,
            status: PurchaseStatus.PENDING,
            payoutStatus: PayoutStatus.HOLDING,
          },
        });

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          customer: stripeCustomerId,
          metadata: {
            purchaseId: purchase.id,
            listingId: listing.id,
            buyerId: buyer.id,
          },
          automatic_payment_methods: { enabled: true },
        });

        await prisma.purchase.update({
          where: { id: purchase.id },
          data: { stripePaymentIntentId: paymentIntent.id },
        });

        return res.json({
          clientSecret: paymentIntent.client_secret,
          purchaseId: purchase.id,
          amount,
          platformFee,
          sellerPayout,
          commissionRate: rate,
        });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post('/trigger-payout/:purchaseId', async (req, res, next) => {
    try {
      if (env.NODE_ENV === 'production') {
        if (!env.CRON_SECRET) throw new HttpError(500, 'CRON_SECRET must be set in production');
        if (req.headers['x-cron-secret'] !== env.CRON_SECRET) throw new HttpError(401, 'Unauthorized');
      } else if (env.CRON_SECRET && req.headers['x-cron-secret'] !== env.CRON_SECRET) {
        throw new HttpError(401, 'Unauthorized');
      }
      const purchaseId = singleParam(req.params.purchaseId, 'purchaseId');
      const transfer = await transferPurchaseToSeller(stripe, purchaseId);
      return res.json({ ok: true, transferId: transfer.id });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
