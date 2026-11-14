/**
 * Trove math for funding an escrow with freshly borrowed MUSD. Mirrors BorrowerOperations
 * (mezo-org/musd): fee = amount × borrowingRate, the fee is added to the debt, a new trove's
 * debt also carries the MUSD gas compensation, ICR = coll × price / debt, NICR = coll × 1e20 /
 * principal, and a draw may not push the debt past the trove's maxBorrowingCapacity.
 * The contract re-checks everything; this only decides what to offer and preview.
 */
import { DECIMAL_PRECISION, NICR_PRECISION } from "@/config/abi/mezo";

export interface TroveParams {
  /** BTC price in MUSD, 18 decimals. */
  price: bigint;
  borrowingRate: bigint;
  minNetDebt: bigint;
  gasCompensation: bigint;
  mcr: bigint;
}

export interface TroveState {
  /** 0 none, 1 active, 2+ closed. */
  status: number;
  coll: bigint;
  debt: bigint;
  principal: bigint;
  maxCapacity: bigint;
}

export const TROVE_ACTIVE = 1;
/** Collateral ratio we suggest for a new trove (the protocol minimum is 110%). */
export const SUGGESTED_CR = 2n * DECIMAL_PRECISION;
/** Below this we warn: close to liquidation if BTC moves. */
export const COMFORT_CR = (15n * DECIMAL_PRECISION) / 10n;

export const borrowingFee = (amount: bigint, rate: bigint) => (amount * rate) / DECIMAL_PRECISION;

/** Collateral ratio (18 decimals); "infinite" when there is no debt. */
export function crOf(coll: bigint, debt: bigint, price: bigint): bigint {
  if (debt === 0n) return 2n ** 128n;
  return (coll * price) / debt;
}

/** "185.4%" from an 18-decimal ratio. */
export function formatCr(cr: bigint): string {
  if (cr >= 2n ** 127n) return "∞";
  const tenths = (cr * 1000n) / DECIMAL_PRECISION;
  return `${(Number(tenths) / 10).toFixed(1)}%`;
}

export interface DrawPlan {
  amount: bigint;
  fee: bigint;
  newDebt: bigint;
  newCr: bigint;
  nicr: bigint;
  capacityOk: boolean;
  crOk: boolean;
  ok: boolean;
}

/** Drawing `amount` more MUSD from an existing trove (withdrawMUSD). */
export function planDraw(t: TroveState, p: TroveParams, amount: bigint): DrawPlan {
  const fee = borrowingFee(amount, p.borrowingRate);
  const newDebt = t.debt + amount + fee;
  const newPrincipal = t.principal + amount + fee;
  const newCr = crOf(t.coll, newDebt, p.price);
  const capacityOk = t.maxCapacity >= newDebt;
  const crOk = newCr >= p.mcr;
  const nicr = newPrincipal === 0n ? 0n : (t.coll * NICR_PRECISION) / newPrincipal;
  return { amount, fee, newDebt, newCr, nicr, capacityOk, crOk, ok: amount > 0n && t.status === TROVE_ACTIVE && capacityOk && crOk };
}

/** Most MUSD an active trove can draw right now (respecting both MCR and max capacity). */
export function maxDraw(t: TroveState, p: TroveParams): bigint {
  if (t.status !== TROVE_ACTIVE) return 0n;
  const byCr = (t.coll * p.price) / p.mcr;
  const ceiling = byCr < t.maxCapacity ? byCr : t.maxCapacity;
  if (ceiling <= t.debt) return 0n;
  const amount = ((ceiling - t.debt) * DECIMAL_PRECISION) / (DECIMAL_PRECISION + p.borrowingRate);
  return amount > 1n ? amount - 1n : 0n;
}

export interface OpenPlan {
  debt: bigint;
  coll: bigint;
  fee: bigint;
  netDebt: bigint;
  compositeDebt: bigint;
  cr: bigint;
  nicr: bigint;
  minDebtOk: boolean;
  crOk: boolean;
  ok: boolean;
}

/** Opening a new trove that borrows `debt` MUSD against `coll` BTC (openTrove). */
export function planOpen(p: TroveParams, debt: bigint, coll: bigint): OpenPlan {
  const fee = borrowingFee(debt, p.borrowingRate);
  const netDebt = debt + fee;
  const compositeDebt = netDebt + p.gasCompensation;
  const cr = crOf(coll, compositeDebt, p.price);
  const nicr = compositeDebt === 0n ? 0n : (coll * NICR_PRECISION) / compositeDebt;
  const minDebtOk = netDebt >= p.minNetDebt;
  const crOk = cr >= p.mcr;
  return { debt, coll, fee, netDebt, compositeDebt, cr, nicr, minDebtOk, crOk, ok: debt > 0n && coll > 0n && minDebtOk && crOk };
}

/** Smallest debt a new trove may borrow (net debt incl. fee must reach minNetDebt). */
export function minOpenDebt(p: TroveParams): bigint {
  // debt × (1 + rate) ≥ minNetDebt  →  debt ≥ minNetDebt / (1 + rate), rounded up.
  const d = (p.minNetDebt * DECIMAL_PRECISION + (DECIMAL_PRECISION + p.borrowingRate - 1n)) / (DECIMAL_PRECISION + p.borrowingRate);
  return d;
}

/** BTC collateral that puts a new trove borrowing `debt` at `targetCr` (rounded up to 1e12 wei). */
export function collateralFor(p: TroveParams, debt: bigint, targetCr: bigint = SUGGESTED_CR): bigint {
  const composite = debt + borrowingFee(debt, p.borrowingRate) + p.gasCompensation;
  const raw = (composite * targetCr + p.price - 1n) / p.price;
  const step = 10n ** 12n;
  return ((raw + step - 1n) / step) * step;
}
