import { and, eq, gt } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";
import { createHash } from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionTokenHash?: string;
    }
  }
}

export const authMiddleware: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.tck_session;
  if (!token || typeof token !== "string") {
    next();
    return;
  }

  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [session] = await db
      .select({ session: sessionsTable, user: usersTable })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(sessionsTable.tokenHash, tokenHash),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (session) {
      req.user = session.user;
      req.sessionTokenHash = tokenHash;
    }

    next();
  } catch (error) {
    req.log.error({ err: error }, "Could not load wallet session");
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
  }
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  next();
};
