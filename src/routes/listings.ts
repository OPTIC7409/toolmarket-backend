import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { ListingStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { validateBody } from '../middleware/validateBody.js';
import {
  createListingSchema,
  patchListingSchema,
  listingsQuerySchema,
} from '../validation/schemas.js';
import { getOrCreateSellerProfile } from '../lib/sellerProfile.js';
import { listingCategoryFromFormValue, categoryDisplayLabel } from '../lib/category.js';
import type { ListingCategory } from '@prisma/client';
import type { Env } from '../config/env.js';
import { singleParam } from '../lib/routeParams.js';

function normalizeTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
  return String(input)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function listingRatingAgg(listing: { reviews: { rating: number }[] }) {
  if (listing.reviews.length === 0) return { average: 0, count: 0 };
  const sum = listing.reviews.reduce((a, r) => a + r.rating, 0);
  return { average: sum / listing.reviews.length, count: listing.reviews.length };
}

function serializeListingCard(
  listing: {
    id: string;
    title: string;
    description: string;
    price: unknown;
    category: ListingCategory;
    tags: string[];
    demoVideoUrl: string;
    riskLevel: string;
    featured: boolean;
    purchaseCount: number;
    isVerified: boolean;
    createdAt: Date;
    seller: { slug: string; user: { name: string | null; avatarUrl: string | null }; isVerified: boolean };
    reviews: { rating: number }[];
  }
) {
  const { average, count } = listingRatingAgg(listing);
  return {
    id: listing.id,
    name: listing.title,
    title: listing.title,
    description: listing.description,
    price: Number(listing.price),
    category: categoryDisplayLabel(listing.category),
    categoryKey: listing.category,
    tags: listing.tags,
    demoVideoUrl: listing.demoVideoUrl,
    trustTier: listing.riskLevel === 'USE_AT_OWN_RISK' ? 'own-risk' : 'safe',
    riskLevel: listing.riskLevel,
    verified: listing.isVerified || listing.seller.isVerified,
    featured: listing.featured,
    trending: listing.purchaseCount >= 20,
    rating: Math.round(average * 10) / 10,
    averageRating: Math.round(average * 10) / 10,
    reviewCount: count,
    sales: listing.purchaseCount,
    purchaseCount: listing.purchaseCount,
    sellerSlug: listing.seller.slug,
    sellerName: listing.seller.user.name,
    sellerAvatarUrl: listing.seller.user.avatarUrl,
    sellerHandle: `@${listing.seller.slug}`,
  };
}

export function createListingsRouter(env: Env) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const q = listingsQuerySchema.parse(req.query);
      const andConditions: Prisma.ListingWhereInput[] = [{ status: ListingStatus.LIVE }];
      if (q.category) andConditions.push({ category: q.category });
      if (q.riskLevel) andConditions.push({ riskLevel: q.riskLevel });
      if (q.minPrice !== undefined || q.maxPrice !== undefined) {
        const price: Prisma.FloatFilter = {};
        if (q.minPrice !== undefined) price.gte = q.minPrice;
        if (q.maxPrice !== undefined) price.lte = q.maxPrice;
        andConditions.push({ price });
      }
      if (q.search?.trim()) {
        const s = q.search.trim();
        andConditions.push({
          OR: [
            { title: { contains: s, mode: 'insensitive' } },
            { description: { contains: s, mode: 'insensitive' } },
          ],
        });
      }
      if (q.featured) andConditions.push({ featured: true });
      if (q.verifiedOnly) {
        andConditions.push({
          OR: [{ isVerified: true }, { seller: { isVerified: true } }],
        });
      }
      if (q.trending) andConditions.push({ purchaseCount: { gte: 20 } });

      const where: Prisma.ListingWhereInput = { AND: andConditions };

      const include = {
        seller: { include: { user: { select: { name: true, avatarUrl: true } } } },
        reviews: { select: { rating: true } },
      };

      const rows = await prisma.listing.findMany({ where, include });

      let sorted = [...rows];
      switch (q.sortBy) {
        case 'stars':
          sorted.sort((a, b) => listingRatingAgg(b).average - listingRatingAgg(a).average);
          break;
        case 'recent':
          sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          break;
        case 'price_asc':
          sorted.sort((a, b) => Number(a.price) - Number(b.price));
          break;
        case 'price_desc':
          sorted.sort((a, b) => Number(b.price) - Number(a.price));
          break;
        case 'popular':
        default:
          sorted.sort((a, b) => b.purchaseCount - a.purchaseCount);
      }

      const total = sorted.length;
      const start = (q.page - 1) * q.limit;
      const pageRows = sorted.slice(start, start + q.limit);

      return res.json({
        items: pageRows.map(serializeListingCard),
        total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(total / q.limit),
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/seller/:sellerProfileId', async (req, res, next) => {
    try {
      const sellerProfileId = singleParam(req.params.sellerProfileId, 'sellerProfileId');
      const seller = await prisma.sellerProfile.findFirst({
        where: { OR: [{ id: sellerProfileId }, { slug: sellerProfileId }] },
      });
      if (!seller) throw new HttpError(404, 'Seller not found');

      const listings = await prisma.listing.findMany({
        where: { sellerId: seller.id, status: ListingStatus.LIVE },
        include: {
          seller: { include: { user: { select: { name: true, avatarUrl: true } } } },
          reviews: { select: { rating: true } },
        },
      });
      return res.json({ items: listings.map(serializeListingCard) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = singleParam(req.params.id);
      const listing = await prisma.$transaction(async (tx) => {
        const live = await tx.listing.findFirst({ where: { id, status: ListingStatus.LIVE } });
        if (!live) return null;
        return tx.listing.update({
          where: { id },
          data: { viewCount: { increment: 1 } },
          include: {
            seller: { include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } } },
            reviews: {
              include: {
                buyer: { select: { name: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        });
      });

      if (!listing) throw new HttpError(404, 'Listing not found');

      const { average, count } = listingRatingAgg(listing);
      return res.json({
        id: listing.id,
        name: listing.title,
        title: listing.title,
        description: listing.description,
        price: Number(listing.price),
        category: categoryDisplayLabel(listing.category),
        categoryKey: listing.category,
        tags: listing.tags,
        demoVideoUrl: listing.demoVideoUrl,
        trustTier: listing.riskLevel === 'USE_AT_OWN_RISK' ? 'own-risk' : 'safe',
        riskLevel: listing.riskLevel,
        verified: listing.isVerified || listing.seller.isVerified,
        featured: listing.featured,
        rating: Math.round(average * 10) / 10,
        averageRating: Math.round(average * 10) / 10,
        reviewCount: count,
        sales: listing.purchaseCount,
        purchaseCount: listing.purchaseCount,
        viewCount: listing.viewCount,
        status: listing.status,
        fileUrl: listing.fileUrl,
        accessInstructions: listing.accessInstructions,
        features: listing.features,
        documentationUrl: listing.documentationUrl,
        licenseType: listing.licenseType,
        refundPolicy: listing.refundPolicy,
        seller: {
          id: listing.seller.id,
          slug: listing.seller.slug,
          name: listing.seller.user.name,
          avatarUrl: listing.seller.user.avatarUrl,
          handle: `@${listing.seller.slug}`,
          isVerified: listing.seller.isVerified,
        },
        reviews: listing.reviews.map((r) => ({
          author: r.buyer.name ?? 'Verified buyer',
          rating: r.rating,
          text: r.comment,
          createdAt: r.createdAt,
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/', authenticate(env), requireRole('SELLER'), validateBody(createListingSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createListingSchema>;
      const title = body.title ?? body.agentName!;
      const description = body.description ?? body.agentDescription!;
      const categoryRaw = body.category;
      const category =
        typeof categoryRaw === 'string' ? listingCategoryFromFormValue(categoryRaw) : categoryRaw;

      const r = req as AuthedRequest;
      const profile = await getOrCreateSellerProfile(r.user!);

      const tags = normalizeTags(body.tags);
      const docUrl = (body.documentationUrl || body.documentation || '').trim() || null;
      const fileUrl = body.fileUrl?.trim() || docUrl;

      if (body.supportEmail) {
        await prisma.sellerProfile.update({
          where: { id: profile.id },
          data: { supportEmail: body.supportEmail },
        });
      }

      const listing = await prisma.listing.create({
        data: {
          sellerId: profile.id,
          title,
          description,
          category,
          riskLevel: body.riskLevel ?? 'SAFE',
          demoVideoUrl: body.demoVideoUrl,
          price: body.price,
          tags,
          status: ListingStatus.PENDING_REVIEW,
          fileUrl: fileUrl || null,
          accessInstructions: body.accessInstructions ?? null,
          features: body.features ?? null,
          documentationUrl: docUrl,
          licenseType: body.licenseType ?? null,
          refundPolicy: body.refundPolicy ?? null,
          featured: body.featured ?? false,
        },
        include: {
          seller: { include: { user: { select: { name: true, avatarUrl: true } } } },
          reviews: { select: { rating: true } },
        },
      });

      return res.status(201).json({
        listing: { ...serializeListingCard(listing), status: listing.status },
      });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/:id', authenticate(env), requireRole('SELLER'), validateBody(patchListingSchema), async (req, res, next) => {
    try {
      const id = singleParam(req.params.id);
      const body = req.body as z.infer<typeof patchListingSchema>;
      const r = req as AuthedRequest;
      const profile = await getOrCreateSellerProfile(r.user!);

      const existing = await prisma.listing.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Listing not found');
      if (existing.sellerId !== profile.id) throw new HttpError(403, 'Not your listing');

      const category =
        body.category === undefined
          ? undefined
          : typeof body.category === 'string'
            ? listingCategoryFromFormValue(body.category)
            : body.category;

      const tags = body.tags === undefined ? undefined : normalizeTags(body.tags);

      const updated = await prisma.listing.update({
        where: { id },
        data: {
          title: body.title,
          description: body.description,
          price: body.price,
          category,
          riskLevel: body.riskLevel,
          demoVideoUrl: body.demoVideoUrl,
          fileUrl: body.fileUrl === undefined ? undefined : body.fileUrl,
          accessInstructions: body.accessInstructions === undefined ? undefined : body.accessInstructions,
          tags,
          features: body.features === undefined ? undefined : body.features,
          documentationUrl: body.documentationUrl === undefined ? undefined : body.documentationUrl,
          licenseType: body.licenseType === undefined ? undefined : body.licenseType,
          refundPolicy: body.refundPolicy === undefined ? undefined : body.refundPolicy,
          featured: body.featured,
        },
        include: {
          seller: { include: { user: { select: { name: true, avatarUrl: true } } } },
          reviews: { select: { rating: true } },
        },
      });

      return res.json({
        listing: { ...serializeListingCard(updated), status: updated.status },
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', authenticate(env), async (req, res, next) => {
    try {
      const id = singleParam(req.params.id);
      const r = req as AuthedRequest;
      const existing = await prisma.listing.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Listing not found');

      const isAdmin = r.user!.role === UserRole.ADMIN;
      const profile = await prisma.sellerProfile.findUnique({ where: { userId: r.user!.id } });
      const owner = profile && existing.sellerId === profile.id;
      if (!owner && !isAdmin) throw new HttpError(403, 'Forbidden');

      await prisma.listing.delete({ where: { id } });
      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
