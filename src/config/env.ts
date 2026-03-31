import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters (use 32+ in production)'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  STRIPE_CONNECT_COUNTRY: z.string().length(2).default('US'),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  }, z.string().optional()),
  CRON_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}

/** Split comma-separated origins; trim whitespace and stray CR from Windows-style line endings. */
export function corsOriginList(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim().replace(/\r$/, ''))
    .filter(Boolean);
}

/** In development, allow any http(s) localhost / 127.0.0.1 origin so mismatched ports still work. */
export function isDevLocalhostOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
