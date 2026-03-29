import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { createStripeClient } from './lib/stripe.js';
import { startPayoutCron } from './services/cron.js';

const env = loadEnv();
const app = createApp(env);
const stripe = createStripeClient(env);

startPayoutCron(env, stripe);

app.listen(env.PORT, () => {
  console.log(`Toolmarket API listening on http://localhost:${env.PORT}`);
});
