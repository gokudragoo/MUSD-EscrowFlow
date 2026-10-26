// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Test helper: a contract wallet that can act as a project party (client or freelancer)
///      and, when its `hook()` is invoked mid-transfer by a malicious token, re-enters a target
///      with stored calldata. Records the re-entry outcome instead of bubbling it.
contract PartyProxy {
    address public hookTarget;
    bytes public hookCall;
    bool public hookCalled;
    bool public hookSuccess;
    bytes public hookReturn;

    function exec(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookCall = data;
    }

    function hook() external {
        hookCalled = true;
        (bool ok, bytes memory ret) = hookTarget.call(hookCall);
        hookSuccess = ok;
        hookReturn = ret;
    }
}
