import { parseAbi } from "viem";

/**
 * Minimal ABIs for the Mezo MUSD-system contracts the app calls. Signatures were taken from the
 * verified implementations on explorer.test.mezo.org (BorrowerOperations, TroveManager,
 * SortedTroves, PriceFeed, MUSDSavingsRate).
 */
export const borrowerOperationsAbi = parseAbi([
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function borrowingRate() view returns (uint256)",
  "function getBorrowingFee(uint256 _debt) view returns (uint256)",
  "function minNetDebt() view returns (uint256)",
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function MCR() view returns (uint256)",
  "function CCR() view returns (uint256)",
]);

/** TroveManager.Status: 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption. */
export const troveManagerAbi = parseAbi([
  "function getTroveStatus(address _borrower) view returns (uint8)",
  "function getTroveColl(address _borrower) view returns (uint256)",
  "function getTroveDebt(address _borrower) view returns (uint256)",
  "function getTrovePrincipal(address _borrower) view returns (uint256)",
  "function getTroveMaxBorrowingCapacity(address _borrower) view returns (uint256)",
  "function getCurrentICR(address _borrower, uint256 _price) view returns (uint256)",
]);

export const sortedTrovesAbi = parseAbi([
  "function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)",
]);

export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const savingsRateAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function yieldIndex() view returns (uint256)",
  "function claimableYield(address) view returns (uint256)",
]);

/** Liquity math constants used by MUSD (LiquityMath.sol). */
export const NICR_PRECISION = 10n ** 20n;
export const DECIMAL_PRECISION = 10n ** 18n;
