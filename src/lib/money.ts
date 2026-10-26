/**
 * MUSD money math. All amounts are bigint base units (18 decimals). Decimal strings only at the
 * edges (user input / display). No floating point is ever used for token amounts.
 */
export const MUSD_DECIMALS = 18;
export const ONE_MUSD = 10n ** 18n;
const AMOUNT_RE = /^(0|[1-9]\d{0,26})(\.\d{1,18})?$/;

export class AmountError extends Error {}

/** Strictly parses a human MUSD amount ("40", "40.5", "0.000001"). Throws AmountError. */
export function parseMusd(input: string): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!AMOUNT_RE.test(s)) throw new AmountError(`"${input}" is not a valid MUSD amount`);
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac.replace(".", "") + "0".repeat(MUSD_DECIMALS)).slice(0, MUSD_DECIMALS);
  return BigInt(whole) * ONE_MUSD + BigInt(fracPadded || "0");
}

export function tryParseMusd(input: string | null | undefined): bigint | null {
  if (input == null) return null;
  try {
    return parseMusd(input);
  } catch {
    return null;
  }
}

/** Exact decimal string with no trailing zeros ("40", "40.5"). */
export function toDecimalString(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / ONE_MUSD;
  const frac = (abs % ONE_MUSD).toString().padStart(MUSD_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

function groupThousands(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface FormatOptions {
  /** Max fraction digits shown (truncated, never rounded up). Default 2. */
  maxDecimals?: number;
  /** Min fraction digits shown. Default 2. */
  minDecimals?: number;
  symbol?: boolean;
}

/**
 * Display formatting: thousands separators, truncation toward zero (never overstates a balance),
 * and "<0.01" for dust that would otherwise render as zero.
 */
export function formatMusd(wei: bigint, opts: FormatOptions = {}): string {
  const maxD = opts.maxDecimals ?? 2;
  const minD = Math.min(opts.minDecimals ?? 2, maxD);
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / ONE_MUSD;
  const fracFull = (abs % ONE_MUSD).toString().padStart(MUSD_DECIMALS, "0");
  let frac = fracFull.slice(0, maxD).replace(/0+$/, "");
  if (frac.length < minD) frac = frac.padEnd(minD, "0");
  const suffix = opts.symbol ? " MUSD" : "";
  if (whole === 0n && abs > 0n && /^0*$/.test(fracFull.slice(0, maxD))) {
    return `${neg ? "-" : ""}<0.${"0".repeat(Math.max(0, maxD - 1))}1${suffix}`;
  }
  return `${neg ? "-" : ""}${groupThousands(whole)}${frac ? `.${frac}` : ""}${suffix}`;
}

export function sumWei(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/** Splits `total` into `n` integer parts; the remainder goes to the last part. */
export function splitEvenly(total: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const each = total / BigInt(n);
  const parts = Array.from({ length: n }, () => each);
  parts[n - 1] += total - each * BigInt(n);
  return parts;
}

export interface SumCheck {
  ok: boolean;
  total: bigint;
  /** budget − sum (positive = unallocated, negative = over-allocated) */
  difference: bigint;
}

/** Milestone amounts must add up EXACTLY to the budget, and each must be > 0. */
export function checkMilestoneSum(budget: bigint, amounts: readonly bigint[]): SumCheck {
  const total = sumWei(amounts);
  const ok = amounts.length > 0 && amounts.every((a) => a > 0n) && total === budget && budget > 0n;
  return { ok, total, difference: budget - total };
}

/** Integer basis points (0..10000) of part/whole, floor. */
export function basisPoints(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const bps = (part * 10_000n) / whole;
  return Number(bps > 10_000n ? 10_000n : bps);
}
