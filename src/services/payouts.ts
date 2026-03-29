import type Stripe from 'stripe';
import {
  DisputeStatus,
  PayoutStatus,
  PurchaseStatus,
  StripeAccountStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';

function openDisputeStatuses(): DisputeStatus[] {
  return [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];
}

export async function assertPurchaseReadyForTransfer(purchaseId: string) {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      seller: true,
      dispute: true,
      listing: true,
    },
  });
  if (!purchase) throw new HttpError(404, 'Purchase not found');
  if (purchase.status !== PurchaseStatus.COMPLETED) {
    throw new HttpError(400, 'Purchase is not completed');
  }
  if (purchase.payoutStatus === PayoutStatus.PAID) {
    throw new HttpError(400, 'Payout already paid');
  }
  if (purchase.payoutPaused) {
    throw new HttpError(400, 'Payout is paused (dispute or hold)');
  }
  if (purchase.dispute && openDisputeStatuses().includes(purchase.dispute.status)) {
    throw new HttpError(400, 'Open dispute blocks payout');
  }
  if (purchase.payoutScheduledAt && purchase.payoutScheduledAt > new Date()) {
    throw new HttpError(400, 'Payout hold not elapsed');
  }
  if (!purchase.seller.stripeAccountId) {
    throw new HttpError(400, 'Seller missing Stripe Connect account');
  }
  if (purchase.seller.stripeAccountStatus !== StripeAccountStatus.ACTIVE) {
    throw new HttpError(400, 'Seller Stripe account not active');
  }
  return purchase;
}

export async function transferPurchaseToSeller(stripe: Stripe, purchaseId: string) {
  const purchase = await assertPurchaseReadyForTransfer(purchaseId);
  const amountCents = Math.round(Number(purchase.sellerPayout) * 100);
  if (amountCents < 1) throw new HttpError(400, 'Invalid payout amount');

  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: purchase.seller.stripeAccountId!,
    metadata: { purchaseId: purchase.id },
  });

  await prisma.purchase.update({
    where: { id: purchase.id },
    data: {
      stripeTransferId: transfer.id,
      payoutStatus: PayoutStatus.PAID,
      payoutPaused: false,
    },
  });

  return transfer;
}

export async function runScheduledPayouts(stripe: Stripe): Promise<{ processed: number; errors: string[] }> {
  const now = new Date();
  const errors: string[] = [];
  const candidates = await prisma.purchase.findMany({
    where: {
      status: PurchaseStatus.COMPLETED,
      payoutStatus: PayoutStatus.HOLDING,
      payoutPaused: false,
      payoutScheduledAt: { lte: now },
      stripeTransferId: null,
    },
    include: { dispute: true },
  });

  let processed = 0;
  for (const p of candidates) {
    if (p.dispute && openDisputeStatuses().includes(p.dispute.status)) continue;
    try {
      await transferPurchaseToSeller(stripe, p.id);
      processed += 1;
    } catch (e) {
      errors.push(`${p.id}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }
  return { processed, errors };
}
