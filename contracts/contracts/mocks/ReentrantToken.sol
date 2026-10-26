// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Malicious token: when armed, every transfer/transferFrom re-enters `target` with
///      `payload` (e.g. a second approveAndRelease) BEFORE moving balances, mimicking an
///      ERC-777-style hook. The outcome of the re-entrant call is recorded, not bubbled, so a
///      test can assert the guard blocked it and the outer call still settled exactly once.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public lastReentrySuccess;
    bytes public lastReentryReturn;
    uint256 public reentryAttempts;

    constructor() ERC20("Reentrant Token", "RNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed && from != address(0) && to != address(0)) {
            armed = false; // single shot
            reentryAttempts += 1;
            (bool ok, bytes memory ret) = target.call(payload);
            lastReentrySuccess = ok;
            lastReentryReturn = ret;
        }
        super._update(from, to, value);
    }
}
