# Backend API Contract (Implemented)

> **Frontend planned calls:** [`toolmarket-ai/API_REQUESTS.md`](../toolmarket-ai/API_REQUESTS.md) — which page uses each route and planned request usage.

Server: `http://localhost:4000` (see `.env` / `.env.example`)

## How `requireRole` works

- **`requireRole('BUYER')`**: satisfied by `BUYER` or `BOTH` (not `SELLER`-only).
- **`requireRole('SELLER')`**: satisfied by `SELLER` or `BOTH`.
- **`ADMIN`**: only matches admin-only routes; admins do not pass buyer/seller checks unless explicitly allowed.

Anywhere this doc says “buyer” or “seller” on a protected route, **`BOTH` counts** unless stated otherwise.

**`ADMIN`**: does **not** satisfy buyer- or seller-guarded routes (`hasRole` returns false for admin on `BUYER`/`SELLER` checks). Admins use `/admin/*` or a separate non-admin user for marketplace flows.

## Auth

- **Protected endpoints** require `Authorization: Bearer <token>`
- Tokens are **HS256 JWTs** issued by this API (`/auth/register`, `/auth/login`, and sometimes refreshed by `/auth/upgrade-to-seller`)
- Roles (Prisma enum): `BUYER | SELLER | BOTH | ADMIN`

---

## `POST /auth/register`

Create a user, and if role is `seller`/`both` also create `SellerProfile`.

**Body**

- `name: string`
- `email: string`
- `password: string` (min 8)
- `role: 'buyer' | 'seller' | 'both'`
- `businessName?: string`
- `bio?: string`

**Response (201)**

- `token: string`
- `user: { id: string; email: string; name: string; role: UserRole }`

Notes

- If `ADMIN_EMAIL` env is set and matches `email` (case-insensitive), role becomes `ADMIN`.

---

## `POST /auth/login`

**Body**

- `email: string`
- `password: string`

**Response (200)**

- `token: string`
- `user: { id: string; email: string; name: string; role: UserRole }`

---

## `GET /auth/me` (protected)

**Response (200)**

- `user: { id; email; name; avatarUrl?; role }`
- `sellerProfile: SellerProfile | null`

---

## `POST /auth/upgrade-to-seller` (protected)

Upgrades a `BUYER` to `BOTH` and ensures a `SellerProfile` exists. Rejects if the user is `ADMIN`.

**Response (200)**

- If already `SELLER` or `BOTH`:
  - `{ ok: true, token: string, role: UserRole, sellerProfile: SellerProfile | null }`
- If upgraded from `BUYER`:
  - `{ token: string, user: User, sellerProfile: SellerProfile }`

*(Frontend should replace stored JWT with `token` whenever one is returned.)*

---

## Listings

### `GET /listings` (public)

Returns only `LIVE` listings.

**Query params**

- `category?: ListingCategory`
- `riskLevel?: RiskLevel`
- `minPrice?: number`
- `maxPrice?: number`
- `sortBy?: 'stars' | 'recent' | 'price_asc' | 'price_desc' | 'popular'` (default: `popular`)
- `page?: number` (default: `1`)
- `limit?: number` (default: `9`, max `50`)
- `search?: string` (searches title/description)

**Response (200)**

- `items: ListingCard[]`
- `total: number`
- `page: number`
- `limit: number`
- `totalPages: number`

`ListingCard` fields (backend output)

- `id`
- `name`, `title`
- `description`
- `price` (number)
- `category` (display label)
- `categoryKey` (enum)
- `tags`
- `demoVideoUrl`
- `trustTier: 'safe' | 'own-risk'`
- `riskLevel`
- `verified`
- `featured`
- `trending`
- `rating`
- `averageRating`
- `reviewCount`
- `sales`
- `purchaseCount`
- `sellerSlug`
- `sellerName`
- `sellerAvatarUrl`
- `sellerHandle`

---

### `GET /listings/:id` (public)

- Requires listing to be `LIVE`
- Increments `viewCount`

**Path params**

- `id: string` (UUID)

**Response (200)**

Full listing detail:

- All `ListingCard` fields plus:
  - `viewCount`
  - `status`
  - `fileUrl?: string | null`
  - `accessInstructions?: string | null`

**Security note:** `fileUrl` and `accessInstructions` are included in this public response today. The Next.js listing page should **not** display them to visitors; treat **`GET /buyer/purchases`** as the delivery surface for buyers. *(Hardening option: redact in the API for non-owners / non-buyers.)*
  - `features?: string | null`
  - `documentationUrl?: string | null`
  - `licenseType?: string | null`
  - `refundPolicy?: string | null`
  - `seller: { id; slug; name; avatarUrl; handle; isVerified }`
  - `reviews: { author; rating; text; createdAt }[]`

---

### `GET /listings/seller/:sellerProfileId` (public)

Returns `LIVE` listings for a seller.

**Path params**

- `sellerProfileId: string` *(seller `id` OR seller `slug`)*

**Response (200)**

- `{ items: ListingCard[] }`

---

### `POST /listings` (protected, seller-capable)

Creates a listing. Enforces:

- `demoVideoUrl` required (URL)
- `price >= 15`
- sets `status = PENDING_REVIEW`

**Body**

Accepts either “frontend-style” or “API-style” field names:

- Title/description:
  - `title?: string` OR `agentName?: string`
  - `description?: string` OR `agentDescription?: string`
- `category: ListingCategory | string`
  - Seller onboarding values supported: `content|analytics|development|marketing|productivity|research|other`
- `demoVideoUrl: string`
- `price: number` (coerced)
- Optional:
  - `riskLevel?: RiskLevel`
  - `features?: string`
  - `tags?: string | string[]`
  - `documentation?: string` OR `documentationUrl?: string`
  - `fileUrl?: string`
  - `accessInstructions?: string`
  - `licenseType?: string`
  - `refundPolicy?: string`
  - `featured?: boolean`
  - `supportEmail?: string` *(stored on `SellerProfile.supportEmail`)*

**Response (201)**

- `{ listing: ListingCard & { status: ListingStatus } }`

---

### `PATCH /listings/:id` (protected, seller-capable + owner)

Updates listing fields (cannot change status here).

**Body**

Any subset of:

- `title`, `description`, `price`, `category`, `riskLevel`, `demoVideoUrl`
- `fileUrl`, `accessInstructions`
- `tags` (string or array)
- `features`, `documentationUrl`, `licenseType`, `refundPolicy`
- `featured`

**Response (200)**

- `{ listing: ListingCard & { status: ListingStatus } }`

---

### `DELETE /listings/:id` (protected; owner or ADMIN)

**Response (204)** no body.

---

## Stripe Connect (Seller onboarding)

### `POST /stripe/connect/create-account` (protected, seller-capable)

Creates Stripe Express account and stores `stripeAccountId`.

**Response (201/200)**

- `{ accountId: string }` or `{ accountId: string, existing: true }`

---

### `POST /stripe/connect/create-onboarding-link` (protected, seller-capable)

**Response (200)**

- `{ url: string }`

---

### `GET /stripe/connect/account-status` (protected, seller-capable)

**Response (200)**

- `status: StripeAccountStatus`
- `chargesEnabled: boolean`
- `payoutsEnabled: boolean`
- `requirements: object`

---

## Stripe payments / purchases

### `POST /checkout/create-payment-intent` (protected, buyer-capable)

`BUYER` or `BOTH`. Requires `Authorization` + `Content-Type: application/json`.

**Body**

- `listingId: string` (UUID)

**Response (200)**

- `clientSecret: string | null`
- `purchaseId: string`
- `amount: number`
- `platformFee: number`
- `sellerPayout: number`
- `commissionRate: number`

---

### `POST /stripe/webhook` (Stripe → backend)

**Raw body required.** Verifies signature with `STRIPE_WEBHOOK_SECRET`.

Handles:

- `payment_intent.succeeded` → `Purchase.COMPLETED`, sets `payoutScheduledAt = now + 7 days`
- `payment_intent.payment_failed` → `Purchase.FAILED`
- `transfer.created` → `Purchase.payoutStatus = PAID`

**Response (200)** `{ received: true }`

---

### `POST /checkout/trigger-payout/:purchaseId` (internal)

Creates Stripe `Transfer` to connected account when eligible.

**Headers**

- In production: `x-cron-secret: <CRON_SECRET>`

**Response (200)**

- `{ ok: true, transferId: string }`

---

## Buyer

### `GET /buyer/purchases` (protected, buyer-capable)

`BUYER` or `BOTH`.

**Response (200)**

- `{ items: BuyerPurchase[] }`

Fields include:

- `id`, `purchaseId`, `listingId`, `listingTitle`
- `agent` (listing title)
- `seller`, `sellerSlug`
- `purchasedAt` (ISO), `purchasedAtLabel`
- `amount` (string like `$49.00`), `amountValue`
- `status` (enum), `statusLabel` (`Delivered`/`Refund requested`/`Disputed`)
- `disputeWindow` (e.g. `5 days left` or `Closed`)
- `rating?: number`
- `fileUrl`, `accessInstructions`
- `payoutStatus`
- `stripePaymentIntentId`

---

### `POST /buyer/dispute/:purchaseId` (protected, buyer-capable)

`purchaseId` = **`Purchase.id`** (same as `id` / `purchaseId` on purchase list items). Only allowed within 7 days of purchase, and only for completed purchases.

**Body**

- `reason: string` (min 3)

**Response (201)**

- `{ ok: true }`

---

### `POST /buyer/review/:purchaseId` (protected, buyer-capable)

`purchaseId` = **`Purchase.id`**. Only allowed after the 7-day dispute window; one review per purchase. Open disputes must be resolved first.

**Body**

- `rating: number` (integer 1–5)
- `comment: string` (min 1)

**Response (201)**

- `{ review: Review }`

---

## Seller

### `GET /seller/dashboard` (protected, seller-capable)

`SELLER` or `BOTH`.

**Response (200)**

- `totalSales`
- `totalRevenue`
- `thisMonthRevenue`
- `pendingPayout`
- `activeListings`
- `commissionRate`
- `isPro`
- `recentPurchases[]`
- `recentReviews[]`

---

### `GET /seller/listings` (protected, seller-capable)

**Response (200)**

- `{ items: SellerListingRow[] }`

---

### `GET /seller/payouts` (protected, seller-capable)

**Response (200)**

- `{ items: SellerPayoutRow[] }`

---

## Admin

All admin endpoints require `Authorization: Bearer <token>` where user role is `ADMIN`.

### `PATCH /admin/listings/:id/approve`

Sets `status = LIVE`.

### `PATCH /admin/listings/:id/suspend`

Sets `status = SUSPENDED`.

### `PATCH /admin/sellers/:id/verify`

Sets `SellerProfile.isVerified = true`.

### `GET /admin/disputes`

Returns all disputes with `OPEN` or `UNDER_REVIEW`.

### `PATCH /admin/disputes/:id/resolve`

**Body**

- `resolution: 'buyer' | 'seller'`
- `note: string`

**Behavior**

- If `buyer`: creates Stripe refund (if PaymentIntent exists) and marks purchase as `REFUNDED`
- If `seller`: unpauses payout; attempts transfer immediately (may still be blocked by hold timing)

---

## Misc

### `POST /waitlist` (public)

**Body**: `{ email: string }`  
**Response (201)**: `{ ok: true }` (upsert / deduped by email)

### `GET /categories` (public)

**Response**

- `{ items: Array<{ key: ListingCategory; label: string; count: number }> }`

### `GET /stats` (public)

**Response**

- `totalListings`
- `totalPaidToSellers`
- `totalBuyers`
- `totalReviews`

