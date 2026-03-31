import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/httpError.js';
import { authenticate, type AuthedRequest } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validateBody.js';
import type { Env } from '../config/env.js';
import { singleParam } from '../lib/routeParams.js';

const createConversationSchema = z.object({
  sellerProfileId: z.string().uuid(),
});

const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export function createMessagesRouter(_env: Env) {
  const router = Router();

  router.get('/conversations', authenticate(_env), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const userId = r.user!.id;

      const conversations = await prisma.conversation.findMany({
        where: {
          OR: [{ buyerId: userId }, { seller: { userId } }],
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          buyer: { select: { id: true, name: true, email: true } },
          seller: { include: { user: { select: { name: true, email: true } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      const items = conversations.map((c) => {
        const isBuyer = c.buyerId === userId;
        const peer = isBuyer
          ? { name: c.seller.user.name, email: c.seller.user.email }
          : { name: c.buyer.name, email: c.buyer.email };
        const last = c.messages[0];
        return {
          id: c.id,
          isBuyer,
          peerName: peer.name ?? peer.email,
          peerEmail: peer.email,
          lastMessagePreview: last ? (last.body.length > 120 ? `${last.body.slice(0, 117)}…` : last.body) : null,
          lastMessageAt: last?.createdAt.toISOString() ?? c.updatedAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        };
      });

      return res.json({ items });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/conversations',
    authenticate(_env),
    validateBody(createConversationSchema),
    async (req, res, next) => {
      try {
        const r = req as AuthedRequest;
        const userId = r.user!.id;
        const { sellerProfileId } = req.body as z.infer<typeof createConversationSchema>;

        const seller = await prisma.sellerProfile.findUnique({
          where: { id: sellerProfileId },
          include: { user: { select: { id: true } } },
        });
        if (!seller) throw new HttpError(404, 'Seller not found');
        if (seller.userId === userId) throw new HttpError(400, 'You cannot message yourself');

        const existing = await prisma.conversation.findUnique({
          where: {
            buyerId_sellerId: { buyerId: userId, sellerId: sellerProfileId },
          },
        });

        const conversation = existing
          ? existing
          : await prisma.conversation.create({
              data: { buyerId: userId, sellerId: sellerProfileId },
            });

        return res.status(existing ? 200 : 201).json({
          conversation: {
            id: conversation.id,
            sellerProfileId,
          },
        });
      } catch (e) {
        next(e);
      }
    }
  );

  router.get('/conversations/:id', authenticate(_env), async (req, res, next) => {
    try {
      const r = req as AuthedRequest;
      const userId = r.user!.id;
      const id = singleParam(req.params.id);

      const conversation = await prisma.conversation.findFirst({
        where: {
          id,
          OR: [{ buyerId: userId }, { seller: { userId } }],
        },
        include: {
          buyer: { select: { id: true, name: true, email: true } },
          seller: { include: { user: { select: { name: true, email: true } } } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (!conversation) throw new HttpError(404, 'Conversation not found');

      const isBuyer = conversation.buyerId === userId;
      const peer = isBuyer
        ? { name: conversation.seller.user.name, email: conversation.seller.user.email }
        : { name: conversation.buyer.name, email: conversation.buyer.email };

      return res.json({
        id: conversation.id,
        isBuyer,
        peerName: peer.name ?? peer.email,
        peerEmail: peer.email,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          body: m.body,
          senderId: m.senderId,
          isMine: m.senderId === userId,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/conversations/:id/messages',
    authenticate(_env),
    validateBody(postMessageSchema),
    async (req, res, next) => {
      try {
        const r = req as AuthedRequest;
        const userId = r.user!.id;
        const id = singleParam(req.params.id);
        const { body: text } = req.body as z.infer<typeof postMessageSchema>;

        const conversation = await prisma.conversation.findFirst({
          where: {
            id,
            OR: [{ buyerId: userId }, { seller: { userId } }],
          },
        });

        if (!conversation) throw new HttpError(404, 'Conversation not found');

        const msg = await prisma.$transaction(async (tx) => {
          const created = await tx.message.create({
            data: {
              conversationId: id,
              senderId: userId,
              body: text,
            },
          });
          await tx.conversation.update({
            where: { id },
            data: { updatedAt: new Date() },
          });
          return created;
        });

        return res.status(201).json({
          message: {
            id: msg.id,
            body: msg.body,
            senderId: msg.senderId,
            isMine: true,
            createdAt: msg.createdAt.toISOString(),
          },
        });
      } catch (e) {
        next(e);
      }
    }
  );

  return router;
}
