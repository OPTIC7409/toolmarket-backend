import { Router } from 'express';
import { ListingStatus, PurchaseStatus, PayoutStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import type { Env } from '../config/env.js';
import { categoryDisplayLabel } from '../lib/category.js';

function listingRatingAgg(reviews: { rating: number }[]) {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((a, r) => a + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

export function createSellerRouter(env: Env) {
  const router = Router();

  router.get('/listings', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      if (!profile) throw new HttpError(400, 'Seller profile missing');
      const listings = await prisma.listing.findMany({
        where: { sellerId: profile.id },
        orderBy: { updatedAt: 'desc' },
        include: { reviews: { select: { rating: true } } },
      });
      return res.json({
        items: listings.map((l) => ({
          id: l.id,
          name: l.title,
          title: l.title,
          category: categoryDisplayLabel(l.category),
          categoryKey: l.category,
          price: `$${Number(l.price)}`,
          priceValue: Number(l.price),
          status: l.status,
          statusLabel:
            l.status === ListingStatus.LIVE
        ? 'Live'
        : l.status === ListingStatus.PENDING_REVIEW
        ? 'In review'
              : l.status === ListingStatus.DRAFT
                ? 'Draft'
                : l.status,
          tier:
            l.riskLevel === 'USE_AT_OWN_RISK'
              ? '⚠️ Use at own risk'
              : l.riskLevel === 'NOT_LISTED'
                ? '—'
                : '✅ Safe',
          sales: l.purchaseCount,
          rating: listingRatingAgg(l.reviews),
          verified: l.isVerified,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/dashboard', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({
        where: { userId: r.user!.id },
        include: {
          listings: { include: { reviews: { select: { rating: true } } } },
        },
      });
      if (!profile) throw new HttpError(400, 'Seller profile missing');

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const purchases = await prisma.purchase.findMany({
        where: { sellerId: profile.id, status: PurchaseStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { listing: { select: { title: true } }, buyer: { select: { email: true, name: true } } },
      });

      const pendingPayout = await prisma.purchase.aggregate({
        where: {
          sellerId: profile.id,
          payoutStatus: { in: [PayoutStatus.HOLDING, PayoutStatus.SCHEDULED] },
          status: PurchaseStatus.COMPLETED,
        },
        _sum: { sellerPayout: true },
      });

      const thisMonthRevenue = await prisma.purchase.aggregate({
        where: {
          sellerId: profile.id,
          status: PurchaseStatus.COMPLETED,
          createdAt: { gte: monthStart },
        },
        _sum: { sellerPayout: true },
      });

      const activeListings = profile.listings.filter(
        (l) => l.status === ListingStatus.LIVE || l.status === ListingStatus.PENDING_REVIEW
      ).length;

      const recentReviews = await prisma.review.findMany({
        where: { listing: { sellerId: profile.id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { listing: { select: { title: true } }, buyer: { select: { email: true } } },
      });

      return res.json({
        totalSales: profile.totalSales,
        totalRevenue: Number(profile.totalRevenue),
        thisMonthRevenue: Number(thisMonthRevenue._sum.sellerPayout ?? 0),
        pendingPayout: Number(pendingPayout._sum.sellerPayout ?? 0),
        activeListings,
        commissionRate: profile.commissionRate,
        isPro: profile.isPro,
        recentPurchases: purchases.map((p) => ({
          id: p.id,
          listingTitle: p.listing.title,
          buyerEmail: p.buyer.email,
          buyerName: p.buyer.name,
          amount: Number(p.amount),
          sellerPayout: Number(p.sellerPayout),
          createdAt: p.createdAt,
        })),
        recentReviews: recentReviews.map((r) => ({
          listingTitle: r.listing.title,
          buyer: r.buyer.email,
          rating: r.rating,
          note: r.comment,
          createdAt: r.createdAt,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/payouts', authenticate(env), requireRole('SELLER'), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      if (!profile) throw new HttpError(400, 'Seller profile missing');

      const purchases = await prisma.purchase.findMany({
        where: { sellerId: profile.id, status: PurchaseStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const items = purchases.map((p) => {
        let status: 'Pending' | 'Scheduled' | 'Paid' = 'Pending';
        if (p.payoutStatus === PayoutStatus.PAID) status = 'Paid';
        else if (p.payoutScheduledAt && p.payoutScheduledAt > new Date()) status = 'Scheduled';

        const eta =
          p.payoutStatus === PayoutStatus.PAID
        ? '—'
        : p.payoutScheduledAt
          ? p.payoutScheduledAt.toLocaleDateString()
          : '—';

        return {
          id: p.id,
          amount: `$${Number(p.sellerPayout).toFixed(2)}`,
          status,
          eta,
          hold: '7-day hold',
          payoutStatus: p.payoutStatus,
          payoutScheduledAt: p.payoutScheduledAt,
          stripeTransferId: p.stripeTransferId,
        };
      });

      return res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
