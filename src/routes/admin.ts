import { Router } from 'express';
import {
  ListingStatus,
  DisputeStatus,
  PurchaseStatus,
  PayoutStatus,
} from '@prisma/client';
import type Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateBody } from '../middleware/validateBody.js';
import { adminResolveDisputeSchema } from '../validation/schemas.js';
import { transferPurchaseToSeller } from '../services/payouts.js';
import type { Env } from '../config/env.js';
import { singleParam } from '../lib/routeParams.js';

export function createAdminRouter(env: Env, stripe: Stripe) {
  const router = Router();
  const guard = [authenticate(env), requireRole('ADMIN')];

  router.patch('/listings/:id/approve', ...guard, async (req, res, next) => {
    try {
      const listing = await prisma.listing.update({
        where: { id: singleParam(req.params.id) },
        data: { status: ListingStatus.LIVE },
      });
      return res.json({ listing });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/listings/:id/suspend', ...guard, async (req, res, next) => {
    try {
      const listing = await prisma.listing.update({
        where: { id: singleParam(req.params.id) },
        data: { status: ListingStatus.SUSPENDED },
      });
      return res.json({ listing });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/sellers/:id/verify', ...guard, async (req, res, next) => {
    try {
      const profile = await prisma.sellerProfile.update({
        where: { id: singleParam(req.params.id) },
        data: { isVerified: true },
      });
      return res.json({ sellerProfile: profile });
    } catch (e) {
      next(e);
    }
  });

  router.get('/disputes', ...guard, async (_req, res, next) => {
    try {
      const disputes = await prisma.dispute.findMany({
        where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } },
        orderBy: { createdAt: 'desc' },
        include: {
          purchase: { include: { listing: true, buyer: { select: { email: true, name: true } } } },
          buyer: { select: { email: true, name: true } },
        },
      });
      return res.json({ items: disputes });
    } catch (e) {
      next(e);
    }
  });

  router.patch(
    '/disputes/:id/resolve',
    ...guard,
    validateBody(adminResolveDisputeSchema),
    async (req, res, next) => {
      try {
        const { resolution, note } = req.body as { resolution: 'buyer' | 'seller'; note: string };
        const dispute = await prisma.dispute.findUnique({
          where: { id: singleParam(req.params.id) },
          include: { purchase: true },
        });
        if (!dispute) throw new HttpError(404, 'Dispute not found');
        const purchaseRow = dispute.purchase;

        if (resolution === 'buyer') {
          const pi = purchaseRow.stripePaymentIntentId;
          if (pi) {
            await stripe.refunds.create({ payment_intent: pi });
          }
          await prisma.$transaction([
            prisma.dispute.update({
              where: { id: dispute.id },
              data: {
                status: DisputeStatus.RESOLVED_BUYER,
                resolutionNote: note,
                resolvedAt: new Date(),
              },
            }),
            prisma.purchase.update({
              where: { id: purchaseRow.id },
              data: {
                status: PurchaseStatus.REFUNDED,
                payoutStatus: PayoutStatus.HOLDING,
                payoutPaused: false,
              },
            }),
          ]);
        } else {
          await prisma.$transaction(async (tx) => {
            await tx.dispute.update({
              where: { id: dispute.id },
              data: {
                status: DisputeStatus.RESOLVED_SELLER,
                resolutionNote: note,
                resolvedAt: new Date(),
              },
            });
            await tx.purchase.update({
              where: { id: purchaseRow.id },
              data: { payoutPaused: false },
            });
          });
          try {
            await transferPurchaseToSeller(stripe, purchaseRow.id);
          } catch (err) {
            // transfer may still be blocked until hold elapses — surface partial success
            return res.json({
              ok: true,
              disputeId: dispute.id,
              payoutQueued: false,
              payoutMessage: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return res.json({ ok: true, disputeId: dispute.id });
      } catch (e) {
        next(e);
      }
    }
  );

  return router;
}
