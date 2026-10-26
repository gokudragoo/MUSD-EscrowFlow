// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Token whose outgoing transfers can be switched to fail in two ways:
///      ReturnFalse (non-reverting `false`, like some legacy tokens) or Revert.
///      transferFrom (funding) is unaffected so a project can be funded first.
contract FaultyToken is ERC20 {
    enum Mode {
        Normal,
        ReturnFalse,
        Revert
    }

    Mode public mode;

    constructor() ERC20("Faulty Token", "FLT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (mode == Mode.ReturnFalse) return false;
        if (mode == Mode.Revert) revert("FaultyToken: transfer blocked");
        return super.transfer(to, value);
    }
}
