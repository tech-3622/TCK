import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  GetSessionResponse,
  LoginMemberBody,
  LoginMemberResponse,
  RegisterMemberBody,
  RegisterMemberResponse,
  LogoutMemberResponse,
} from "@workspace/api-zod";
import {
  appSettingsTable,
  db,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { hashSecret, verifySecret } from "../lib/security";
import { publicUser } from "../lib/format";

const router: IRouter = Router();
const SESSION_DAYS = 7;

async function issueSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({ userId, tokenHash, expiresAt });
  return token;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie("tck_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

router.get("/auth/me", (req, res) => {
  const result = GetSessionResponse.parse(
    req.user
      ? { authenticated: true, user: publicUser(req.user) }
      : { authenticated: false, user: null },
  );
  res.json(result);
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the details and try again." });
    return;
  }

  const username = parsed.data.username.trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    res.status(400).json({
      error: "Use 3–32 letters, numbers, or underscores for your username.",
    });
    return;
  }

  const passwordHash = await hashSecret(parsed.data.password);
  try {
    const newUser = await db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.id, 1))
        .for("update");
      if (!settings) throw new Error("Wallet settings have not been initialized.");

      const isFirstAdmin = !settings.firstAdminAssigned;
      const [user] = await tx
        .insert(usersTable)
        .values({ username, email, passwordHash, isAdmin: isFirstAdmin })
        .returning();
      await tx
        .update(appSettingsTable)
        .set({ firstAdminAssigned: true, updatedAt: new Date() })
        .where(eq(appSettingsTable.id, 1));

      return user;
    });

    const token = await issueSession(newUser.id);
    setSessionCookie(res, token);
    res
      .status(201)
      .json(
        RegisterMemberResponse.parse({
          authenticated: true,
          user: publicUser(newUser),
        }),
      );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({ error: "That username or email is already in use." });
      return;
    }
    req.log.error({ err: error }, "Member registration failed");
    res.status(500).json({ error: "Could not create your account." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your username/email and password." });
    return;
  }

  const identifier = parsed.data.identifier.trim();
  const normalizedEmail = identifier.toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);
  const [byUsername] = user
    ? [undefined]
    : await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, identifier))
        .limit(1);
  const matchedUser = user ?? byUsername;

  if (!matchedUser || !(await verifySecret(parsed.data.password, matchedUser.passwordHash))) {
    res.status(401).json({ error: "The username/email or password is incorrect." });
    return;
  }

  const token = await issueSession(matchedUser.id);
  setSessionCookie(res, token);
  res.json(
    LoginMemberResponse.parse({
      authenticated: true,
      user: publicUser(matchedUser),
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  if (req.sessionTokenHash) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, req.sessionTokenHash));
  }
  res.clearCookie("tck_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json(LogoutMemberResponse.parse({ success: true }));
});

export default router;
