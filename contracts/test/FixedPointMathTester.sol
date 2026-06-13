// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../libraries/FixedPointMath.sol";

contract FixedPointMathTester {
    using FixedPointMath for int256;

    function testSigmoid(int256 x) external pure returns (int256) {
        return FixedPointMath.sigmoid(x);
    }

    function testMul(int256 a, int256 b) external pure returns (int256) {
        return a.mul(b);
    }

    function testDiv(int256 a, int256 b) external pure returns (int256) {
        return a.div(b);
    }
}
