import { z } from 'zod';
import { ListingCategory, RiskLevel, UserRole } from '@prisma/client';

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(['buyer', 'seller', 'both']),
  /** Optional extras when registering as seller/both — aligns with seller onboarding step 1 */
  businessName: z.string().optional(),
  bio: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const waitlistSchema = z.object({
  email: z.string().email(),
});

export const listingsQuerySchema = z.object({
  category: z.nativeEnum(ListingCategory).optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  sortBy: z.enum(['stars', 'recent', 'price_asc', 'price_desc', 'popular']).optional().default('popular'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(50).optional().default(9),
  search: z.string().optional(),
  /** Query boolean: pass `true` to filter */
  featured: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  verifiedOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  trending: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const tagInput = z.union([z.string(), z.array(z.string())]).optional();

export const createListingSchema = z
  .object({
    title: z.string().min(1).optional(),
    agentName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    agentDescription: z.string().min(1).optional(),
    category: z.union([z.nativeEnum(ListingCategory), z.string().min(1)]),
    riskLevel: z.nativeEnum(RiskLevel).optional(),
    demoVideoUrl: z.string().url(),
    fileUrl: z.string().url().optional().or(z.literal('')),
    accessInstructions: z.string().optional(),
    tags: tagInput,
    price: z.coerce.number().positive(),
    features: z.string().optional(),
    documentation: z.string().url().optional().or(z.literal('')),
    documentationUrl: z.string().url().optional().or(z.literal('')),
    licenseType: z.string().optional(),
    refundPolicy: z.string().optional(),
    featured: z.boolean().optional(),
    supportEmail: z.string().email().optional(),
  })
  .superRefine((val, ctx) => {
    const title = val.title ?? val.agentName;
    const description = val.description ?? val.agentDescription;
    if (!title) ctx.addIssue({ code: 'custom', message: 'title or agentName required', path: ['title'] });
    if (!description)
      ctx.addIssue({ code: 'custom', message: 'description or agentDescription required', path: ['description'] });
    if (val.price < 15) ctx.addIssue({ code: 'custom', message: 'Minimum listing price is $15', path: ['price'] });
  });

export const patchListingSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    price: z.coerce.number().positive().optional(),
    category: z.union([z.nativeEnum(ListingCategory), z.string().min(1)]).optional(),
    riskLevel: z.nativeEnum(RiskLevel).optional(),
    demoVideoUrl: z.string().url().optional(),
    fileUrl: z.string().url().nullable().optional(),
    accessInstructions: z.string().nullable().optional(),
    tags: tagInput,
    features: z.string().nullable().optional(),
    documentationUrl: z.string().url().nullable().optional(),
    licenseType: z.string().nullable().optional(),
    refundPolicy: z.string().nullable().optional(),
    featured: z.boolean().optional(),
  })
  .strict();

export const createPaymentIntentSchema = z.object({
  listingId: z.string().uuid(),
});

export const disputeSchema = z.object({
  reason: z.string().min(3),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1),
});

export const adminResolveDisputeSchema = z.object({
  resolution: z.enum(['buyer', 'seller']),
  note: z.string().min(1),
});

export const upgradeToSellerSchema = z.object({}).optional();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Exported for route handlers that need role checks without importing Prisma in every file. */
export { UserRole, ListingCategory, RiskLevel };
