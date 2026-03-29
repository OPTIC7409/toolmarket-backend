import cron from 'node-cron';
import type Stripe from 'stripe';
import type { Env } from '../config/env.js';
import { runScheduledPayouts } from './payouts.js';

export function startPayoutCron(env: Env, stripe: Stripe) {
  cron.schedule('0 * * * *', async () => {
    const { processed, errors } = await runScheduledPayouts(stripe);
    if (processed || errors.length) {
      console.log(`[cron] payouts processed=${processed}`, errors.length ? { errors } : '');
    }
  });
}
