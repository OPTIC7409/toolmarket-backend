import { Router } from 'express';
import { ListingCategory, ListingStatus, PurchaseStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { validateBody } from '../middleware/validateBody.js';
import { waitlistSchema } from '../validation/schemas.js';
import { categoryDisplayLabel } from '../lib/category.js';
import type { Env } from '../config/env.js';

export function createMiscRouter(_env: Env) {
  const router = Router();

  router.post('/waitlist', validateBody(waitlistSchema), async (req, res, next) => {
    try {
      const { email } = req.body as { email: string };
      await prisma.waitlistEntry.upsert({
        where: { email: email.toLowerCase() },
        create: { email: email.toLowerCase() },
        update: {},
      });
      return res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get('/categories', async (_req, res, next) => {
    try {
      const grouped = await prisma.listing.groupBy({
        by: ['category'],
        where: { status: ListingStatus.LIVE },
        _count: { category: true },
      });
      const map = new Map(grouped.map((g) => [g.category, g._count.category]));
      const items = (Object.values(ListingCategory) as ListingCategory[]).map((key) => ({
        key,
        label: categoryDisplayLabel(key),
        count: map.get(key) ?? 0,
      }));
      return res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  router.get('/stats', async (_req, res, next) => {
    try {
      const [totalListings, purchasesAgg, buyerCount, reviewCount] = await Promise.all([
        prisma.listing.count({ where: { status: ListingStatus.LIVE } }),
        prisma.purchase.aggregate({
          where: { status: PurchaseStatus.COMPLETED },
          _sum: { sellerPayout: true },
        }),
        prisma.user.count({
          where: { role: { in: ['BUYER', 'BOTH'] } },
        }),
        prisma.review.count(),
      ]);
      return res.json({
        totalListings,
        totalPaidToSellers: Number(purchasesAgg._sum.sellerPayout ?? 0),
        totalBuyers: buyerCount,
        totalReviews: reviewCount,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
