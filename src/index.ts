import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadEnv } from './config/env.js';

const __filename = fileURLToPath(import.meta.url);
if (path.basename(path.dirname(__filename)) === 'dist') {
  console.warn(
    '[toolmarket] Serving from compiled dist/. Code may be stale. Use `npm run dev` (tsx + src) while developing, or `npm run build` before `npm start`.'
  );
}
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
