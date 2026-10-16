import type {
  Deposit,
  MarketAdjustment,
  Trade,
  User,
  Withdrawal,
} from "@workspace/db";

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    country: user.country,
    kycStatus: user.kycStatus,
    kycDocumentPath: user.kycDocumentPath,
    profileImagePath: user.profileImagePath,
    nairaBalance: Number(user.nairaBalance),
    tckBalance: Number(user.tckBalance),
    hasWithdrawalPin: Boolean(user.withdrawalPinHash),
    createdAt: user.createdAt.toISOString(),
  };
}

export function publicTrade(trade: Trade) {
  return {
    id: trade.id,
    side: trade.side,
    nairaAmount: Number(trade.nairaAmount),
    tckAmount: Number(trade.tckAmount),
    rate: Number(trade.rate),
    createdAt: trade.createdAt.toISOString(),
  };
}

export function publicDeposit(deposit: Deposit) {
  return {
    id: deposit.id,
    amount: Number(deposit.amount),
    proofPath: deposit.proofPath,
    status: deposit.status,
    createdAt: deposit.createdAt.toISOString(),
    reviewedAt: deposit.reviewedAt?.toISOString() ?? null,
  };
}

export function publicWithdrawal(withdrawal: Withdrawal) {
  return {
    id: withdrawal.id,
    amount: Number(withdrawal.amount),
    bankName: withdrawal.bankName,
    accountNumber: withdrawal.accountNumber,
    accountName: withdrawal.accountName,
    status: withdrawal.status,
    createdAt: withdrawal.createdAt.toISOString(),
  };
}

export function publicAdjustment(adjustment: MarketAdjustment, adminUsername: string) {
  return {
    id: adjustment.id,
    direction: adjustment.direction,
    percentage: Number(adjustment.percentage),
    previousRate: Number(adjustment.previousRate),
    newRate: Number(adjustment.newRate),
    adminUsername,
    createdAt: adjustment.createdAt.toISOString(),
  };
}

export const roundNaira = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const roundTck = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;

export function isOwnedObjectPath(path: string, userId: number): boolean {
  return path.startsWith(`/objects/uploads/${userId}/`) && path.length <= 512;
}
