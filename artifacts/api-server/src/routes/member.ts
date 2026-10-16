import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateDepositBody,
  CreateDepositResponse,
  CreateTradeBody,
  CreateTradeResponse,
  CreateWithdrawalBody,
  CreateWithdrawalResponse,
  GetBankDetailsResponse,
  GetMemberDashboardResponse,
  GetProfileResponse,
  GetWalletResponse,
  ListMemberDepositsResponse,
  ListMemberWithdrawalsResponse,
  SetWithdrawalPinBody,
  SetWithdrawalPinResponse,
  SubmitKycBody,
  SubmitKycResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import {
  appSettingsTable,
  db,
  depositsTable,
  tradesTable,
  usersTable,
  wealthHistoryTable,
  withdrawalsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  isOwnedObjectPath,
  publicDeposit,
  publicTrade,
  publicUser,
  publicWithdrawal,
  roundNaira,
  roundTck,
} from "../lib/format";
import { hashSecret, verifySecret } from "../lib/security";

const router: IRouter = Router();

router.get("/dashboard", requireAuth, async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const [[settings], history, trades] = await Promise.all([
    db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1)).limit(1),
    db
      .select()
      .from(wealthHistoryTable)
      .where(eq(wealthHistoryTable.userId, user.id))
      .orderBy(desc(wealthHistoryTable.createdAt))
      .limit(14),
    db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.userId, user.id))
      .orderBy(desc(tradesTable.createdAt))
      .limit(6),
  ]);
  const exchangeRate = Number(settings?.currentRate ?? 100);
  res.json(
    GetMemberDashboardResponse.parse({
      user: publicUser(user),
      exchangeRate,
      totalValue: roundNaira(user.nairaBalance + user.tckBalance * exchangeRate),
      wealthHistory: history.reverse().map((point) => ({
        totalValue: Number(point.totalValue),
        createdAt: point.createdAt.toISOString(),
      })),
      recentTrades: trades.map(publicTrade),
    }),
  );
});

router.get("/wallet", requireAuth, async (req, res): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const [[settings], trades] = await Promise.all([
    db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1)).limit(1),
    db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.userId, user.id))
      .orderBy(desc(tradesTable.createdAt))
      .limit(30),
  ]);
  res.json(
    GetWalletResponse.parse({
      user: publicUser(user),
      exchangeRate: Number(settings?.currentRate ?? 100),
      trades: trades.map(publicTrade),
    }),
  );
});

router.post("/wallet/trades", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid trade amount." });
    return;
  }

  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (parsed.data.amount > 1_000_000_000_000) {
    res.status(400).json({ error: "Trade amount is above the allowed limit." });
    return;
  }

  try {
    const trade = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .for("update");
      const [settings] = await tx
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.id, 1))
        .for("update");
      if (!lockedUser || !settings) throw new Error("Wallet is unavailable.");

      const rate = Number(settings.currentRate);
      let nairaAmount: number;
      let tckAmount: number;
      if (parsed.data.side === "buy") {
        nairaAmount = roundNaira(parsed.data.amount);
        tckAmount = roundTck(nairaAmount / rate);
        if (nairaAmount <= 0 || lockedUser.nairaBalance < nairaAmount) {
          throw new Error("Your available naira balance is too low.");
        }
        await tx
          .update(usersTable)
          .set({
            nairaBalance: roundNaira(lockedUser.nairaBalance - nairaAmount),
            tckBalance: roundTck(lockedUser.tckBalance + tckAmount),
          })
          .where(eq(usersTable.id, lockedUser.id));
      } else {
        tckAmount = roundTck(parsed.data.amount);
        nairaAmount = roundNaira(tckAmount * rate);
        if (tckAmount <= 0 || lockedUser.tckBalance < tckAmount) {
          throw new Error("Your available TCK balance is too low.");
        }
        await tx
          .update(usersTable)
          .set({
            tckBalance: roundTck(lockedUser.tckBalance - tckAmount),
            nairaBalance: roundNaira(lockedUser.nairaBalance + nairaAmount),
          })
          .where(eq(usersTable.id, lockedUser.id));
      }

      const [created] = await tx
        .insert(tradesTable)
        .values({
          userId: lockedUser.id,
          side: parsed.data.side,
          nairaAmount,
          tckAmount,
          rate,
        })
        .returning();
      const nextNaira =
        parsed.data.side === "buy"
          ? roundNaira(lockedUser.nairaBalance - nairaAmount)
          : roundNaira(lockedUser.nairaBalance + nairaAmount);
      const nextTck =
        parsed.data.side === "buy"
          ? roundTck(lockedUser.tckBalance + tckAmount)
          : roundTck(lockedUser.tckBalance - tckAmount);
      await tx.insert(wealthHistoryTable).values({
        userId: lockedUser.id,
        totalValue: roundNaira(nextNaira + nextTck * rate),
      });
      return created;
    });

    res.status(201).json(CreateTradeResponse.parse(publicTrade(trade)));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not complete this trade.";
    if (
      message.includes("balance is too low") ||
      message.includes("above the allowed limit")
    ) {
      res.status(400).json({ error: message });
      return;
    }
    req.log.error({ err: error }, "Trade could not be completed");
    res.status(500).json({ error: "Could not complete this trade." });
  }
});

router.get("/bank", requireAuth, async (_req, res): Promise<void> => {
  const [settings] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1))
    .limit(1);
  res.json(
    GetBankDetailsResponse.parse({
      bankName: settings?.bankName ?? "",
      accountNumber: settings?.accountNumber ?? "",
      accountName: settings?.accountName ?? "",
    }),
  );
});

router.get("/deposits", requireAuth, async (req, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const deposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, req.user.id))
    .orderBy(desc(depositsTable.createdAt))
    .limit(50);
  res.json(ListMemberDepositsResponse.parse(deposits.map(publicDeposit)));
});

router.post("/deposits", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateDepositBody.safeParse(req.body);
  if (!parsed.success || parsed.data.amount > 1_000_000_000_000) {
    res.status(400).json({ error: "Enter a valid amount and payment proof." });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (!isOwnedObjectPath(parsed.data.proofPath, user.id)) {
    res.status(400).json({ error: "Upload a valid payment proof first." });
    return;
  }

  const [deposit] = await db
    .insert(depositsTable)
    .values({
      userId: user.id,
      amount: roundNaira(parsed.data.amount),
      proofPath: parsed.data.proofPath,
    })
    .returning();
  res.status(201).json(CreateDepositResponse.parse(publicDeposit(deposit)));
});

router.get("/withdrawals", requireAuth, async (req, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const withdrawals = await db
    .select()
    .from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, req.user.id))
    .orderBy(desc(withdrawalsTable.createdAt))
    .limit(50);
  res.json(
    ListMemberWithdrawalsResponse.parse(withdrawals.map(publicWithdrawal)),
  );
});

router.post("/withdrawals", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success || parsed.data.amount > 1_000_000_000_000) {
    res.status(400).json({ error: "Check your withdrawal details and try again." });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (user.kycStatus !== "Verified") {
    res.status(400).json({ error: "Complete identity verification before withdrawing." });
    return;
  }
  if (!user.withdrawalPinHash) {
    res.status(400).json({ error: "Set a withdrawal PIN in your profile first." });
    return;
  }
  if (!(await verifySecret(parsed.data.pin, user.withdrawalPinHash))) {
    res.status(400).json({ error: "The withdrawal PIN is incorrect." });
    return;
  }

  const amount = roundNaira(parsed.data.amount);
  if (amount <= 0) {
    res.status(400).json({ error: "Withdrawal amount must be greater than zero." });
    return;
  }

  try {
    const withdrawal = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .for("update");
      if (!lockedUser || lockedUser.nairaBalance < amount) {
        throw new Error("Your available naira balance is too low.");
      }
      await tx
        .update(usersTable)
        .set({ nairaBalance: roundNaira(lockedUser.nairaBalance - amount) })
        .where(eq(usersTable.id, lockedUser.id));
      const [created] = await tx
        .insert(withdrawalsTable)
        .values({
          userId: lockedUser.id,
          amount,
          bankName: parsed.data.bankName.trim(),
          accountNumber: parsed.data.accountNumber.trim(),
          accountName: parsed.data.accountName.trim(),
        })
        .returning();
      const [settings] = await tx
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.id, 1))
        .limit(1);
      await tx.insert(wealthHistoryTable).values({
        userId: lockedUser.id,
        totalValue: roundNaira(
          roundNaira(lockedUser.nairaBalance - amount) +
            lockedUser.tckBalance * Number(settings?.currentRate ?? 100),
        ),
      });
      return created;
    });
    res
      .status(201)
      .json(CreateWithdrawalResponse.parse(publicWithdrawal(withdrawal)));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not submit withdrawal.";
    if (message.includes("balance is too low")) {
      res.status(400).json({ error: message });
      return;
    }
    req.log.error({ err: error }, "Withdrawal could not be submitted");
    res.status(500).json({ error: "Could not submit withdrawal." });
  }
});

router.get("/profile", requireAuth, (req, res): void => {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.json(GetProfileResponse.parse({ user: publicUser(req.user) }));
});

router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check your profile details and try again." });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (
    parsed.data.profileImagePath &&
    !isOwnedObjectPath(parsed.data.profileImagePath, user.id)
  ) {
    res.status(400).json({ error: "Upload a valid profile image first." });
    return;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({
        ...(parsed.data.username !== undefined
          ? { username: parsed.data.username.trim() }
          : {}),
        ...(parsed.data.country !== undefined
          ? { country: parsed.data.country?.trim() || null }
          : {}),
        ...(parsed.data.profileImagePath !== undefined
          ? { profileImagePath: parsed.data.profileImagePath }
          : {}),
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    res.json(UpdateProfileResponse.parse({ user: publicUser(updated) }));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    req.log.error({ err: error }, "Profile update failed");
    res.status(500).json({ error: "Could not update your profile." });
  }
});

router.put("/profile/pin", requireAuth, async (req, res): Promise<void> => {
  const parsed = SetWithdrawalPinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Use a 4–6 digit withdrawal PIN." });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  await db
    .update(usersTable)
    .set({ withdrawalPinHash: await hashSecret(parsed.data.pin) })
    .where(eq(usersTable.id, req.user.id));
  res.json(SetWithdrawalPinResponse.parse({ success: true }));
});

router.post("/profile/kyc", requireAuth, async (req, res): Promise<void> => {
  const parsed = SubmitKycBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add your country and upload an identity document." });
    return;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (!isOwnedObjectPath(parsed.data.documentPath, user.id)) {
    res.status(400).json({ error: "Upload a valid identity document first." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({
      country: parsed.data.country.trim(),
      kycDocumentPath: parsed.data.documentPath,
      kycStatus: "Pending",
    })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(SubmitKycResponse.parse({ user: publicUser(updated) }));
});

export default router;
