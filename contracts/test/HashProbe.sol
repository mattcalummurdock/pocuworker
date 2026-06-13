// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/TensorEvents.sol";

contract HashProbe {
    function hashPacked(int256[] calldata data) external pure returns (bytes32) {
        return TensorEvents.tensorDataHash(data);
    }
}
