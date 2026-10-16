import { and, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AdminDeposit,
  AdminUser,
  AdminWithdrawal,
  AdjustMarketRateBody,
  AdjustMarketRateResponse,
  DecideDepositBody,
  DecideDepositParams,
  DecideDepositResponse,
  DecideUserVerificationBody,
  DecideUserVerificationParams,
  DecideUserVerificationResponse,
  DecideWithdrawalBody,
  DecideWithdrawalParams,
  DecideWithdrawalResponse,
  GetAdminDashboardResponse,
  GetAdminMarketResponse,
  UpdateBankDetailsBody,
  UpdateBankDetailsResponse,
} from "@workspace/api-zod";
import {
  appSettingsTable,
  db,
  depositsTable,
  marketAdjustmentsTable,
  usersTable,
  wealthHistoryTable,
  withdrawalsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import {
  publicAdjustment,
  publicDeposit,
  publicUser,
  publicWithdrawal,
  roundNaira,
} from "../lib/format";

const router: IRouter = Router();

router.get("/admin/dashboard", requireAdmin, async (_req, res): Promise<void> => {
  const [
    [settings],
    [members],
    [pendingDeposits],
    [pendingWithdrawals],
    [pendingKyc],
    users,
    deposits,
    withdrawals,
  ] = await Promise.all([
    db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1)).limit(1),
    db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.isAdmin, false)),
    db
      .select({ total: count() })
      .from(depositsTable)
      .where(eq(depositsTable.status, "Pending")),
    db
      .select({ total: count() })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.status, "Pending")),
    db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.kycStatus, "Pending")),
    db
      .select()
      .from(usersTable)
      .where(eq(usersTable.isAdmin, false))
      .orderBy(desc(usersTable.createdAt))
      .limit(100),
    db
      .select({ deposit: depositsTable, username: usersTable.username })
      .from(depositsTable)
      .innerJoin(usersTable, eq(depositsTable.userId, usersTable.id))
      .where(eq(depositsTable.status, "Pending"))
      .orderBy(desc(depositsTable.createdAt))
      .limit(50),
    db
      .select({ withdrawal: withdrawalsTable, username: usersTable.username })
      .from(withdrawalsTable)
      .innerJoin(usersTable, eq(withdrawalsTable.userId, usersTable.id))
      .where(eq(withdrawalsTable.status, "Pending"))
      .orderBy(desc(withdrawalsTable.createdAt))
      .limit(50),
  ]);

  res.json(
    GetAdminDashboardResponse.parse({
      exchangeRate: Number(settings?.currentRate ?? 100),
      memberCount: Number(members?.total ?? 0),
      pendingDepositCount: Number(pendingDeposits?.total ?? 0),
      pendingWithdrawalCount: Number(pendingWithdrawals?.total ?? 0),
      pendingKycCount: Number(pendingKyc?.total ?? 0),
      users: users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          country: user.country,
          kycStatus: user.kycStatus,
          kycDocumentPath: user.kycDocumentPath,
          createdAt: user.createdAt.toISOString(),
        })),
      deposits: deposits.map(({ deposit, username }) => ({
        ...publicDeposit(deposit),
        username,
      })),
      withdrawals: withdrawals.map(({ withdrawal, username }) => ({
          ...publicWithdrawal(withdrawal),
          username,
        })),
    }),
  );
});

router.patch(
  "/admin/deposits/:id/decision",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DecideDepositParams.safeParse(req.params);
    const body = DecideDepositBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid deposit decision." });
      return;
    }

    const deposit = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(depositsTable)
        .where(
          and(
            eq(depositsTable.id, params.data.id),
            eq(depositsTable.status, "Pending"),
          ),
        )
        .for("update");
      if (!pending) return null;

      const now = new Date();
      const status = body.data.decision === "approve" ? "Approved" : "Rejected";
      const [updated] = await tx
        .update(depositsTable)
        .set({ status, reviewedAt: now })
        .where(eq(depositsTable.id, pending.id))
        .returning();

      if (body.data.decision === "approve") {
        const [user] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, pending.userId))
          .for("update");
        if (!user) return null;
        const nextBalance = roundNaira(user.nairaBalance + Number(pending.amount));
        await tx
          .update(usersTable)
          .set({ nairaBalance: nextBalance })
          .where(eq(usersTable.id, user.id));
        const [settings] = await tx
          .select()
          .from(appSettingsTable)
          .where(eq(appSettingsTable.id, 1))
          .limit(1);
        await tx.insert(wealthHistoryTable).values({
          userId: user.id,
          totalValue: roundNaira(
            nextBalance + user.tckBalance * Number(settings?.currentRate ?? 100),
          ),
        });
      }
      return updated;
    });

    if (!deposit) {
      res.status(404).json({ error: "This deposit is no longer pending." });
      return;
    }
    const [member] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, deposit.userId))
      .limit(1);
    res.json(
      DecideDepositResponse.parse({
        ...publicDeposit(deposit),
        username: member?.username ?? "Member",
      }),
    );
  },
);

router.patch(
  "/admin/withdrawals/:id/decision",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DecideWithdrawalParams.safeParse(req.params);
    const body = DecideWithdrawalBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid withdrawal decision." });
      return;
    }

    const withdrawal = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(withdrawalsTable)
        .where(
          and(
            eq(withdrawalsTable.id, params.data.id),
            eq(withdrawalsTable.status, "Pending"),
          ),
        )
        .for("update");
      if (!pending) return null;

      const status = body.data.decision === "approve" ? "Approved" : "Rejected";
      const [updated] = await tx
        .update(withdrawalsTable)
        .set({ status })
        .where(eq(withdrawalsTable.id, pending.id))
        .returning();

      if (body.data.decision === "reject") {
        const [user] = await tx
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, pending.userId))
          .for("update");
        if (user) {
          const restoredBalance = roundNaira(
            user.nairaBalance + Number(pending.amount),
          );
          await tx
            .update(usersTable)
            .set({ nairaBalance: restoredBalance })
            .where(eq(usersTable.id, user.id));
          const [settings] = await tx
            .select()
            .from(appSettingsTable)
            .where(eq(appSettingsTable.id, 1))
            .limit(1);
          await tx.insert(wealthHistoryTable).values({
            userId: user.id,
            totalValue: roundNaira(
              restoredBalance + user.tckBalance * Number(settings?.currentRate ?? 100),
            ),
          });
        }
      }
      return updated;
    });

    if (!withdrawal) {
      res.status(404).json({ error: "This withdrawal is no longer pending." });
      return;
    }
    const [member] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, withdrawal.userId))
      .limit(1);
    res.json(
      DecideWithdrawalResponse.parse({
        ...publicWithdrawal(withdrawal),
        username: member?.username ?? "Member",
      }),
    );
  },
);

router.patch(
  "/admin/users/:id/verification",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DecideUserVerificationParams.safeParse(req.params);
    const body = DecideUserVerificationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid verification decision." });
      return;
    }

    const [user] = await db
      .update(usersTable)
      .set({
        kycStatus: body.data.decision === "approve" ? "Verified" : "Rejected",
      })
      .where(
        and(
          eq(usersTable.id, params.data.id),
          eq(usersTable.kycStatus, "Pending"),
        ),
      )
      .returning();
    if (!user || user.isAdmin) {
      res.status(404).json({ error: "This member is not awaiting verification." });
      return;
    }

    res.json(
      DecideUserVerificationResponse.parse({
        id: user.id,
        username: user.username,
        email: user.email,
        country: user.country,
        kycStatus: user.kycStatus,
        kycDocumentPath: user.kycDocumentPath,
        createdAt: user.createdAt.toISOString(),
      }),
    );
  },
);

router.get("/admin/market", requireAdmin, async (_req, res): Promise<void> => {
  const [[settings], rows] = await Promise.all([
    db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1)).limit(1),
    db
      .select({
        adjustment: marketAdjustmentsTable,
        username: usersTable.username,
      })
      .from(marketAdjustmentsTable)
      .innerJoin(
        usersTable,
        eq(marketAdjustmentsTable.adminUserId, usersTable.id),
      )
      .orderBy(desc(marketAdjustmentsTable.createdAt))
      .limit(30),
  ]);
  res.json(
    GetAdminMarketResponse.parse({
      currentRate: Number(settings?.currentRate ?? 100),
      adjustments: rows.map(({ adjustment, username }) =>
        publicAdjustment(adjustment, username),
      ),
    }),
  );
});

router.post(
  "/admin/market/adjustments",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = AdjustMarketRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a direction and a valid percentage." });
      return;
    }
    const admin = req.user;
    if (!admin) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }

    const adjustment = await db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.id, 1))
        .for("update");
      if (!settings) throw new Error("Market settings are unavailable.");
      const previousRate = Number(settings.currentRate);
      const multiplier =
        parsed.data.direction === "increase"
          ? 1 + parsed.data.percentage / 100
          : 1 - parsed.data.percentage / 100;
      const newRate = Math.round(previousRate * multiplier * 10_000) / 10_000;
      if (!Number.isFinite(newRate) || newRate < 0.01 || newRate > 1_000_000_000) {
        throw new Error("That change would put the exchange rate outside safe limits.");
      }

      await tx
        .update(appSettingsTable)
        .set({ currentRate: newRate, updatedAt: new Date() })
        .where(eq(appSettingsTable.id, 1));
      const [created] = await tx
        .insert(marketAdjustmentsTable)
        .values({
          adminUserId: admin.id,
          direction: parsed.data.direction,
          percentage: parsed.data.percentage,
          previousRate,
          newRate,
        })
        .returning();
      return created;
    });

    res
      .status(201)
      .json(
        AdjustMarketRateResponse.parse(publicAdjustment(adjustment, admin.username)),
      );
  },
);

router.put("/admin/bank", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateBankDetailsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the bank details and try again." });
    return;
  }
  const [settings] = await db
    .update(appSettingsTable)
    .set({
      bankName: parsed.data.bankName.trim(),
      accountNumber: parsed.data.accountNumber.trim(),
      accountName: parsed.data.accountName.trim(),
      updatedAt: new Date(),
    })
    .where(eq(appSettingsTable.id, 1))
    .returning();

  res.json(
    UpdateBankDetailsResponse.parse({
      bankName: settings?.bankName ?? "",
      accountNumber: settings?.accountNumber ?? "",
      accountName: settings?.accountName ?? "",
    }),
  );
});

export default router;
