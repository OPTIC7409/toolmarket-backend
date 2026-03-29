import { randomBytes } from 'node:crypto';

const MAX_LEN = 48;

export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN);
  return base || 'seller';
}

export function uniqueSlugSuffix(): string {
  return randomBytes(3).toString('hex');
}
