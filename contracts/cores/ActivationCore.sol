// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseCore.sol";
import "../libraries/CpuOpCodes.sol";
import "../libraries/FixedPointMath.sol";

/// @title CoreB — Activation functions (cpuarc Layer 2)
contract ActivationCore is BaseCore {
    using FixedPointMath for int256;

    constructor(address _jobRegistry) BaseCore(_jobRegistry) {}

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata,
        int256[] calldata params
    ) internal pure override returns (int256[] memory out) {
        out = new int256[](inData.length);
        if (opcode == CpuOpCodes.RELU) {
            for (uint256 i = 0; i < inData.length; i++) out[i] = FixedPointMath.relu(inData[i]);
            return out;
        }
        if (opcode == CpuOpCodes.SIGMOID) {
            for (uint256 i = 0; i < inData.length; i++) out[i] = FixedPointMath.sigmoid(inData[i]);
            return out;
        }
        if (opcode == CpuOpCodes.TANH) {
            for (uint256 i = 0; i < inData.length; i++) out[i] = FixedPointMath.tanh(inData[i]);
            return out;
        }
        if (opcode == CpuOpCodes.GELU) {
            for (uint256 i = 0; i < inData.length; i++) out[i] = FixedPointMath.gelu(inData[i]);
            return out;
        }
        if (opcode == CpuOpCodes.SOFTMAX) {
            require(inShape.length >= 1, "SOFTMAX shape");
            int256[] memory logits = new int256[](inShape[inShape.length - 1]);
            uint256 classes = inShape[inShape.length - 1];
            uint256 offset = inData.length - classes;
            for (uint256 i = 0; i < classes; i++) logits[i] = inData[offset + i];
            return FixedPointMath.softmax(logits);
        }
        if (opcode == CpuOpCodes.DROPOUT_MASK) {
            require(params.length >= 1, "DROPOUT needs timestamp");
            uint256 ts = uint256(uint256(params[0]) % (1 << 32));
            for (uint256 i = 0; i < inData.length; i++) {
                uint256 bit = (ts >> (i % 32)) & 1;
                out[i] = bit != 0 ? inData[i] : int256(0);
            }
            return out;
        }
        revert("Activation: bad opcode");
    }
}
