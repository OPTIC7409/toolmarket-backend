import { ListingCategory } from '@prisma/client';

/** Maps seller onboarding `<select value="...">` to Prisma `ListingCategory`. */
export function listingCategoryFromFormValue(v: string): ListingCategory {
  const key = v.trim().toLowerCase();
  const map: Record<string, ListingCategory> = {
    content: ListingCategory.PRODUCTIVITY,
    analytics: ListingCategory.RESEARCH,
    development: ListingCategory.SCRAPERS,
    marketing: ListingCategory.SOCIAL_MEDIA,
    productivity: ListingCategory.PRODUCTIVITY,
    research: ListingCategory.RESEARCH,
    trading: ListingCategory.TRADING_BOTS,
    'lead-gen': ListingCategory.LEAD_GENERATION,
    lead_generation: ListingCategory.LEAD_GENERATION,
    social: ListingCategory.SOCIAL_MEDIA,
    ecommerce: ListingCategory.ECOMMERCE,
    finance: ListingCategory.FINANCE,
    other: ListingCategory.PRODUCTIVITY,
    trading_bots: ListingCategory.TRADING_BOTS,
  };
  if (key in map) return map[key] as ListingCategory;
  if ((Object.values(ListingCategory) as string[]).includes(v)) {
    return v as ListingCategory;
  }
  return ListingCategory.PRODUCTIVITY;
}

export function categoryDisplayLabel(c: ListingCategory): string {
  const labels: Record<ListingCategory, string> = {
    TRADING_BOTS: 'Trading Bots',
    LEAD_GENERATION: 'Lead Generation',
    SOCIAL_MEDIA: 'Social Media',
    ECOMMERCE: 'E-commerce',
    SCRAPERS: 'Scrapers',
    RESEARCH: 'Research',
    PRODUCTIVITY: 'Productivity',
    FINANCE: 'Finance',
  };
  return labels[c];
}
