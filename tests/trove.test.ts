import { describe, expect, it } from "vitest";
import { borrowingFee, collateralFor, crOf, formatCr, maxDraw, minOpenDebt, planDraw, planOpen, type TroveParams, type TroveState } from "@/lib/trove";

const E18 = 10n ** 18n;
// Live Mezo testnet parameters read from BorrowerOperations / PriceFeed (Nov 2026).
const P: TroveParams = {
  price: 67_114_230_320_000_000_000_000n,
  borrowingRate: 1_000_000_000_000_000n, // 0.1%
  minNetDebt: 1800n * E18,
  gasCompensation: 200n * E18,
  mcr: (11n * E18) / 10n,
};

const trove = (coll: bigint, debt: bigint, cap: bigint): TroveState => ({ status: 1, coll, debt, principal: debt, maxCapacity: cap });

describe("trove math (mirrors BorrowerOperations)", () => {
  it("charges the borrowing fee on the drawn amount", () => {
    expect(borrowingFee(1000n * E18, P.borrowingRate)).toBe(1n * E18);
  });

  it("computes collateral ratios and formats them", () => {
    // 0.1 BTC at 67,114.23 against 3,000 MUSD ≈ 223.7%
    const cr = crOf(E18 / 10n, 3000n * E18, P.price);
    expect(formatCr(cr)).toBe("223.7%");
    expect(formatCr(crOf(1n, 0n, P.price))).toBe("∞");
  });

  it("previews a draw: fee added to the debt, ratio and capacity checked", () => {
    const t = trove(E18 / 10n, 2000n * E18, 6000n * E18);
    const plan = planDraw(t, P, 20n * E18);
    expect(plan.fee).toBe(20n * E18 / 1000n);
    expect(plan.newDebt).toBe(2020n * E18 + 20n * E18 / 1000n);
    expect(plan.ok).toBe(true);
  });

  it("rejects a draw past the trove's max borrowing capacity even if the ratio allows it", () => {
    const t = trove(E18, 2000n * E18, 2010n * E18);
    expect(planDraw(t, P, 20n * E18).capacityOk).toBe(false);
    expect(planDraw(t, P, 20n * E18).ok).toBe(false);
  });

  it("maxDraw stays inside both MCR and capacity, with the fee accounted for", () => {
    const t = trove(E18 / 10n, 2000n * E18, 10_000n * E18);
    const m = maxDraw(t, P);
    expect(planDraw(t, P, m).ok).toBe(true);
    expect(planDraw(t, P, m + 10n ** 15n).ok).toBe(false);
    expect(maxDraw({ ...t, status: 0 }, P)).toBe(0n);
  });

  it("plans a new trove: minimum net debt, gas compensation and suggested collateral", () => {
    const debt = minOpenDebt(P);
    expect(debt + borrowingFee(debt, P.borrowingRate)).toBeGreaterThanOrEqual(P.minNetDebt);
    const coll = collateralFor(P, debt);
    const plan = planOpen(P, debt, coll);
    expect(plan.ok).toBe(true);
    expect(plan.compositeDebt).toBe(plan.netDebt + 200n * E18);
    // suggested 200% target, rounded up
    expect(plan.cr).toBeGreaterThanOrEqual(2n * E18);
    expect(planOpen(P, 100n * E18, coll).minDebtOk).toBe(false);
    expect(planOpen(P, debt, coll / 3n).crOk).toBe(false);
  });
});
