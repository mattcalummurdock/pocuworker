// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice On-chain CPU instruction set (cpuarc.md Layer 2).
library CpuOpCodes {
    // CoreA — LinearAlgebra
    uint8 internal constant MATMUL = 1;
    uint8 internal constant ADD = 2;
    uint8 internal constant SUB = 3;
    uint8 internal constant MUL_SCALAR = 4;
    uint8 internal constant DOT = 5;
    uint8 internal constant OUTER = 6;
    uint8 internal constant TRANSPOSE = 7;
    uint8 internal constant CONV2D = 8;
    uint8 internal constant FLATTEN = 9;

    // CoreB — Activation
    uint8 internal constant RELU = 16;
    uint8 internal constant SIGMOID = 17;
    uint8 internal constant SOFTMAX = 18;
    uint8 internal constant TANH = 19;
    uint8 internal constant GELU = 20;
    uint8 internal constant DROPOUT_MASK = 21;

    // CoreC — Gradient
    uint8 internal constant CROSS_ENTROPY = 32;
    uint8 internal constant MSE = 33;
    uint8 internal constant BACKWARD_SOFTMAX = 34;
    uint8 internal constant BACKWARD_MATMUL = 35;
    uint8 internal constant BACKWARD_RELU = 36;
    uint8 internal constant BACKWARD_SIGMOID = 37;
    uint8 internal constant BACKWARD_TANH = 38;
    uint8 internal constant BACKWARD_GELU = 39;

    // CoreD — Optimizer
    uint8 internal constant SGD = 48;
    uint8 internal constant ADAM = 49;
    uint8 internal constant RMSPROP = 50;
    uint8 internal constant LR_FROM_TIMESTAMP = 51;

    // CoreE — Aggregation
    uint8 internal constant REDUCE_SUM = 64;
    uint8 internal constant REDUCE_MEAN = 65;
    uint8 internal constant MAXPOOL = 66;
    uint8 internal constant LAYERNORM = 67;
    uint8 internal constant HISTOGRAM = 68;
    uint8 internal constant SPLIT_GAIN = 69;
    uint8 internal constant LEAF_AGGREGATE = 70;

    function coreForOpcode(uint8 opcode) internal pure returns (uint8 coreId) {
        if (opcode >= 1 && opcode <= 9) return 1;
        if (opcode >= 16 && opcode <= 21) return 2;
        if (opcode >= 32 && opcode <= 39) return 3;
        if (opcode >= 48 && opcode <= 51) return 4;
        if (opcode >= 64 && opcode <= 70) return 5;
        revert("Unknown opcode");
    }
}
