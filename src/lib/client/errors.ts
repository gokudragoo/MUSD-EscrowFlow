import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Plain-language explanations of every EscrowFlow custom error. */
export const CONTRACT_ERRORS: Record<string, string> = {
  ZeroAddress: "An address is missing.",
  InvalidParty: "Client, freelancer and arbiter must be three different wallets.",
  InvalidMilestoneCount: "A project needs between 1 and 20 milestones.",
  LengthMismatch: "Milestone data is inconsistent.",
  ZeroAmount: "Every milestone needs an amount above zero.",
  AmountOverflow: "The total amount is too large.",
  InvalidDeadline: "A milestone deadline is in the past or too far in the future.",
  InvalidReviewPeriod: "Review periods must be between 1 minute and 90 days.",
  InvalidGracePeriod: "The grace period can be at most 90 days.",
  EmptyTermsHash: "The terms document hash is missing.",
  ProjectNotFound: "This escrow does not exist on-chain.",
  NotClient: "Only the client of this escrow can do that.",
  NotFreelancer: "Only the freelancer of this escrow can do that.",
  NotParty: "Only the client or the freelancer can do that.",
  NotArbiter: "Only the agreed arbiter can do that.",
  NotDisputeInitiator: "Only the party who opened the dispute can withdraw it.",
  InvalidProjectStatus: "The escrow is not in the right state for this action.",
  InvalidMilestoneStatus: "The milestone is not in the right state for this action.",
  InvalidMilestoneIndex: "That milestone does not exist.",
  TermsMismatch: "The terms changed since you opened them. Reload and review the latest version.",
  DeadlinePassed: "A milestone deadline has already passed. Update the terms before funding.",
  FundingShortfall: "The escrow received less MUSD than the agreed total, so funding was rejected.",
  EmptySubmission: "The submission record is missing.",
  ReviewWindowElapsed: "The agreed review period has ended.",
  ReviewWindowOpen: "The client's review period is still running.",
  AutoReleaseDisabled: "Auto-release is not part of these terms.",
  ReclaimDisabled: "Deadline reclaim is not part of these terms.",
  ReclaimNotYetAvailable: "The deadline plus grace period has not passed yet.",
  NoSettlementProposal: "There is no settlement proposal to accept.",
  CannotAcceptOwnProposal: "The other party has to accept your proposal.",
  SettlementMismatch: "The settlement proposal changed. Review the latest amount.",
  SettlementExceedsAmount: "A split cannot exceed the milestone amount.",
  NoCancellationProposal: "There is no cancellation proposal.",
  ProjectAlreadyCancelled: "This escrow was already cancelled.",
  DisputeLockedByCancellation: "After a mutual cancellation the dispute must be settled, not withdrawn.",
  ReentrancyGuardReentrantCall: "Re-entrant call blocked.",
  SafeERC20FailedOperation: "The MUSD transfer failed.",
  ERC20InsufficientAllowance: "The escrow is not approved to move that much MUSD yet.",
  ERC20InsufficientBalance: "Your MUSD balance is too low.",
};

export function describeTxError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (reverted.reason) return reverted.reason;
    }
    const msg = err.shortMessage || err.message;
    if (/user rejected|denied/i.test(msg)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(msg)) return "Not enough testnet BTC for gas. Get some from the Mezo faucet.";
    if (/EIP-7623|gas limit/i.test(msg)) return "The network rejected the gas limit. Try again.";
    return msg.split("\n")[0];
  }
  if (err instanceof Error) {
    if (/user rejected|denied/i.test(err.message)) return "You rejected the request in your wallet.";
    return err.message.split("\n")[0];
  }
  return "Something went wrong.";
}
