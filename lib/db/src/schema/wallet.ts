import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable("wallet_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  country: text("country"),
  kycStatus: text("kyc_status").notNull().default("Unverified"),
  kycDocumentPath: text("kyc_document_path"),
  profileImagePath: text("profile_image_path"),
  nairaBalance: numeric("naira_balance", {
    precision: 18,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  tckBalance: numeric("tck_balance", {
    precision: 20,
    scale: 8,
    mode: "number",
  })
    .notNull()
    .default(0),
  withdrawalPinHash: text("withdrawal_pin_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const appSettingsTable = pgTable("wallet_app_settings", {
  id: integer("id").primaryKey(),
  currentRate: numeric("current_rate", {
    precision: 18,
    scale: 4,
    mode: "number",
  })
    .notNull()
    .default(100),
  firstAdminAssigned: boolean("first_admin_assigned").notNull().default(false),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  accountName: text("account_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessionsTable = pgTable("wallet_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tradesTable = pgTable("wallet_trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  side: text("side").notNull(),
  nairaAmount: numeric("naira_amount", {
    precision: 18,
    scale: 2,
    mode: "number",
  }).notNull(),
  tckAmount: numeric("tck_amount", {
    precision: 20,
    scale: 8,
    mode: "number",
  }).notNull(),
  rate: numeric("rate", {
    precision: 18,
    scale: 4,
    mode: "number",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const depositsTable = pgTable("wallet_deposits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", {
    precision: 18,
    scale: 2,
    mode: "number",
  }).notNull(),
  proofPath: text("proof_path").notNull(),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const withdrawalsTable = pgTable("wallet_withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", {
    precision: 18,
    scale: 2,
    mode: "number",
  }).notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wealthHistoryTable = pgTable("wallet_wealth_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  totalValue: numeric("total_value", {
    precision: 18,
    scale: 2,
    mode: "number",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const marketAdjustmentsTable = pgTable("wallet_market_adjustments", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id")
    .notNull()
    .references(() => usersTable.id),
  direction: text("direction").notNull(),
  percentage: numeric("percentage", {
    precision: 10,
    scale: 4,
    mode: "number",
  }).notNull(),
  previousRate: numeric("previous_rate", {
    precision: 18,
    scale: 4,
    mode: "number",
  }).notNull(),
  newRate: numeric("new_rate", {
    precision: 18,
    scale: 4,
    mode: "number",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  createdAt: true,
});
export const insertDepositSchema = createInsertSchema(depositsTable).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});
export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({
  id: true,
  createdAt: true,
});
export const insertMarketAdjustmentSchema = createInsertSchema(
  marketAdjustmentsTable,
).omit({ id: true, createdAt: true });

export type User = typeof usersTable.$inferSelect;
export type NewUser = z.infer<typeof insertUserSchema>;
export type Trade = typeof tradesTable.$inferSelect;
export type NewTrade = z.infer<typeof insertTradeSchema>;
export type Deposit = typeof depositsTable.$inferSelect;
export type NewDeposit = z.infer<typeof insertDepositSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
export type NewWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type MarketAdjustment = typeof marketAdjustmentsTable.$inferSelect;
export type NewMarketAdjustment = z.infer<typeof insertMarketAdjustmentSchema>;
