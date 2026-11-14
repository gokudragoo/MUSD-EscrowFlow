// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Test stand-in for Mezo's MUSDSavingsRate (sMUSD) vault. The deposit / withdraw /
///      claimYield / receiveProtocolYield / yield-index logic is copied from the verified source;
///      proxy, Ownable, ERC2771, strategy and gauge cap are dropped (the idle strategy holds the
///      principal here). The PCV `distributeMUSD()` call that the real vault makes at the start of
///      deposit/withdraw is modelled by `queueProtocolYield`: queued MUSD is distributed as
///      protocol yield on the next deposit/withdraw.
///      Test knobs: block or short-change withdrawals, block claims, under-mint deposits.
contract MockSavingsVault is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public musdToken;
    uint256 public yieldIndex;
    mapping(address => uint256) public supplyYieldIndex;
    mapping(address => uint256) public claimableYield;
    uint256 public pendingYield;

    // --- test knobs ---
    uint256 public queuedProtocolYield; // distributed at the start of the next deposit / withdraw
    bool public withdrawBlocked;
    uint256 public withdrawShortfall; // withdraw returns `amount - withdrawShortfall` principal
    bool public claimBlocked;
    uint256 public depositUnderMint; // deposit mints `amount - depositUnderMint` sMUSD

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event ProtocolYieldReceived(uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);

    error ZeroAmount();
    error InsufficientBalance();
    error AmountTooSmall();

    constructor(IERC20 musd) ERC20("MUSD Savings Rate", "sMUSD") {
        musdToken = musd;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _distributeQueued();

        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount - depositUnderMint);
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();
        require(!withdrawBlocked, "MockSavingsVault: withdraw blocked");
        _distributeQueued();

        _claimYield(msg.sender);

        _burn(msg.sender, amount);
        musdToken.safeTransfer(msg.sender, amount - withdrawShortfall);
        emit Withdraw(msg.sender, amount);
    }

    function claimYield() external returns (uint256) {
        require(!claimBlocked, "MockSavingsVault: claim blocked");
        return _claimYield(msg.sender);
    }

    function _claimYield(address depositor) internal returns (uint256) {
        _updateYieldFor(depositor);
        uint256 claimable = claimableYield[depositor];
        if (claimable > 0) {
            claimableYield[depositor] -= claimable;
            musdToken.safeTransfer(depositor, claimable);
            emit YieldClaimed(depositor, claimable);
        }
        return claimable;
    }

    /// @notice Anyone may push MUSD yield to sMUSD holders (as the MUSD PCV does).
    function receiveProtocolYield(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        _receiveYield(amount);
        emit ProtocolYieldReceived(amount);
    }

    function _receiveYield(uint256 amount) internal returns (uint256 _totalSupply) {
        _totalSupply = totalSupply();
        if (_totalSupply > 0) {
            uint256 totalYieldToDistribute = amount + pendingYield;
            pendingYield = 0;
            uint256 _ratio = (totalYieldToDistribute * 1e18) / _totalSupply;
            if (_ratio > 0) {
                yieldIndex += _ratio;
            } else {
                revert AmountTooSmall();
            }
        } else {
            pendingYield += amount;
        }
    }

    function _updateYieldFor(address recipient) internal {
        uint256 _supplied = balanceOf(recipient);
        if (_supplied > 0) {
            uint256 _supplyYieldIndex = supplyYieldIndex[recipient];
            uint256 _yieldIndex = yieldIndex;
            supplyYieldIndex[recipient] = _yieldIndex;
            uint256 _delta = _yieldIndex - _supplyYieldIndex;
            if (_delta > 0) {
                uint256 _share = (_supplied * _delta) / 1e18;
                claimableYield[recipient] += _share;
            }
        } else {
            supplyYieldIndex[recipient] = yieldIndex;
        }
    }

    function yieldToken() external view returns (address) {
        return address(musdToken);
    }

    /// @dev Mirrors the real vault's `_beforeTokenTransfer` hook (runs before balances change).
    function _update(address from, address to, uint256 value) internal override {
        if (from != to) {
            _updateYieldFor(from);
            _updateYieldFor(to);
        }
        super._update(from, to, value);
    }

    // --- test helpers ---

    function queueProtocolYield(uint256 amount) external {
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        queuedProtocolYield += amount;
    }

    /// @dev The real vault wraps `pcv.distributeMUSD()` in try/catch, so a distribution that would
    ///      revert (AmountTooSmall) never blocks a deposit / withdraw: it is simply skipped.
    function _distributeQueued() internal {
        uint256 q = queuedProtocolYield;
        if (q == 0) return;
        uint256 supply = totalSupply();
        if (supply > 0 && ((q + pendingYield) * 1e18) / supply == 0) return;
        queuedProtocolYield = 0;
        _receiveYield(q);
        emit ProtocolYieldReceived(q);
    }

    function setWithdrawBlocked(bool blocked) external {
        withdrawBlocked = blocked;
    }

    function setWithdrawShortfall(uint256 shortfall) external {
        withdrawShortfall = shortfall;
    }

    function setClaimBlocked(bool blocked) external {
        claimBlocked = blocked;
    }

    function setDepositUnderMint(uint256 underMint) external {
        depositUnderMint = underMint;
    }
}
