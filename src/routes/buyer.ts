import { Router } from 'express';
import {
  DisputeStatus,
  PurchaseStatus,
  PayoutStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateBody } from '../middleware/validateBody.js';
import { disputeSchema, reviewSchema } from '../validation/schemas.js';
import type { Env } from '../config/env.js';
import { singleParam } from '../lib/routeParams.js';

const DISPUTE_MS = 7 * 24 * 60 * 60 * 1000;

function disputeWindowLabel(purchasedAt: Date) {
  const end = new Date(purchasedAt.getTime() + DISPUTE_MS);
  const now = Date.now();
  if (now > end.getTime()) return 'Closed';
  const daysLeft = Math.ceil((end.getTime() - now) / (24 * 60 * 60 * 1000));
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

function openDisputeStatuses(): DisputeStatus[] {
  return [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];
}

export function createBuyerRouter(env: Env) {
  const router = Router();

  router.get('/purchases', authenticate(env), requireRole('BUYER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const purchases = await prisma.purchase.findMany({
        where: { buyerId: r.user!.id },
        orderBy: { createdAt: 'desc' },
        include: {
          listing: true,
          seller: { include: { user: { select: { name: true } } } },
          dispute: true,
          review: true,
        },
      });

      const items = purchases.map((p) => {
        let statusLabel: 'Delivered' | 'Refund requested' | 'Disputed' = 'Delivered';
        if (p.dispute && openDisputeStatuses().includes(p.dispute.status)) statusLabel = 'Disputed';
        else if (p.status === PurchaseStatus.REFUNDED) statusLabel = 'Refund requested';
        return {
          id: p.id,
          purchaseId: p.id,
          agent: p.listing.title,
          listingId: p.listingId,
          listingTitle: p.listing.title,
          seller: p.seller.businessName ?? p.seller.user.name ?? p.seller.slug,
          sellerSlug: p.seller.slug,
          purchasedAt: p.createdAt.toISOString(),
          purchasedAtLabel: p.createdAt.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
          amount: `$${Number(p.amount).toFixed(2)}`,
          amountValue: Number(p.amount),
          status: p.status,
          statusLabel,
          disputeWindow: disputeWindowLabel(p.createdAt),
          downloads: 0,
          rating: p.review?.rating,
          fileUrl: p.listing.fileUrl,
          accessInstructions: p.listing.accessInstructions,
          payoutStatus: p.payoutStatus,
          stripePaymentIntentId: p.stripePaymentIntentId,
        };
      });

      return res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  router.post('/dispute/:purchaseId', authenticate(env), requireRole('BUYER'), validateBody(disputeSchema), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const purchaseId = singleParam(req.params.purchaseId, 'purchaseId');
      const { reason } = req.body as { reason: string };

      const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { dispute: true },
      });
      if (!purchase || purchase.buyerId !== r.user!.id) throw new HttpError(404, 'Purchase not found');
      if (purchase.status !== PurchaseStatus.COMPLETED) {
        throw new HttpError(400, 'Only completed purchases can be disputed');
      }
      if (Date.now() > purchase.createdAt.getTime() + DISPUTE_MS) {
        throw new HttpError(400, 'Dispute window has closed (7 days)');
      }
      if (purchase.dispute) throw new HttpError(400, 'Dispute already exists');

      await prisma.$transaction(async (tx) => {
        await tx.dispute.create({
          data: {
            purchaseId: purchase.id,
            buyerId: r.user!.id,
            reason,
            status: DisputeStatus.OPEN,
          },
        });
        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            payoutPaused: true,
            payoutStatus: PayoutStatus.HOLDING,
          },
        });
      });

      return res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.post('/review/:purchaseId', authenticate(env), requireRole('BUYER'), validateBody(reviewSchema), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const purchaseId = singleParam(req.params.purchaseId, 'purchaseId');
      const { rating, comment } = req.body as { rating: number; comment: string };

      const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { dispute: true, review: true },
      });
      if (!purchase || purchase.buyerId !== r.user!.id) throw new HttpError(404, 'Purchase not found');
      if (purchase.status !== PurchaseStatus.COMPLETED) throw new HttpError(400, 'Purchase not completed');
      if (purchase.review) throw new HttpError(400, 'Review already submitted');
      if (Date.now() < purchase.createdAt.getTime() + DISPUTE_MS) {
        throw new HttpError(400, 'Reviews open after the 7-day dispute window');
      }
      if (purchase.dispute && openDisputeStatuses().includes(purchase.dispute.status)) {
        throw new HttpError(400, 'Resolve open disputes before reviewing');
      }

      const review = await prisma.review.create({
        data: {
          purchaseId: purchase.id,
          buyerId: r.user!.id,
          listingId: purchase.listingId,
          rating,
          comment,
        },
      });
      return res.status(201).json({ review });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
