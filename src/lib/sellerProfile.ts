import type { Prisma } from '@prisma/client';
import type { SellerProfile, User, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { HttpError } from './httpError.js';
import { slugify, uniqueSlugSuffix } from './slug.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function ensureUniqueSellerSlug(tx: DbClient, base: string): Promise<string> {
  let candidate = slugify(base);
  for (let i = 0; i < 8; i += 1) {
    const exists = await tx.sellerProfile.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
    candidate = `${slugify(base)}-${uniqueSlugSuffix()}`;
  }
  throw new HttpError(500, 'Could not allocate seller slug');
}

function roleMayList(role: UserRole): boolean {
  return role === 'SELLER' || role === 'BOTH' || role === 'ADMIN';
}

/**
 * Listing routes require a SellerProfile row. Creates one if the user is allowed to sell
 * but the row is missing (e.g. ADMIN users, or repaired accounts).
 */
export async function getOrCreateSellerProfile(user: User): Promise<SellerProfile> {
  const existing = await prisma.sellerProfile.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  if (!roleMayList(user.role)) {
    throw new HttpError(400, 'Seller profile missing');
  }

  return prisma.$transaction(async (tx) => {
    const again = await tx.sellerProfile.findUnique({ where: { userId: user.id } });
    if (again) return again;
    const slug = await ensureUniqueSellerSlug(tx, user.name);
    return tx.sellerProfile.create({
      data: {
        userId: user.id,
        slug,
        commissionRate: 0.15,
      },
    });
  });
}
