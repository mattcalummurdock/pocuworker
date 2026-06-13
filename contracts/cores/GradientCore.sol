// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseCore.sol";
import "../libraries/CpuOpCodes.sol";
import "../libraries/FixedPointMath.sol";
import "../libraries/TensorOps.sol";

/// @title CoreC — Loss and backward ops (cpuarc Layer 2)
contract GradientCore is BaseCore {
    using FixedPointMath for int256;

    function div(int256 a, int256 b) private pure returns (int256) {
        return FixedPointMath.div(a, b);
    }

    constructor(address _jobRegistry) BaseCore(_jobRegistry) {}

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) internal pure override returns (int256[] memory) {
        if (opcode == CpuOpCodes.CROSS_ENTROPY) {
            require(inData.length >= 2, "CE needs pred+label");
            uint256 half = inData.length / 2;
            int256[] memory out = new int256[](1);
            int256 loss = 0;
            for (uint256 i = 0; i < half; i++) {
                int256 p = FixedPointMath.relu(inData[i]);
                int256 y = inData[half + i];
                int256 err = p - y;
                loss += err.mul(err);
            }
            out[0] = loss;
            return out;
        }
        if (opcode == CpuOpCodes.MSE) {
            require(inData.length >= 2 && inData.length % 2 == 0, "MSE pairs");
            uint256 half = inData.length / 2;
            int256[] memory out = new int256[](1);
            int256 loss = 0;
            for (uint256 i = 0; i < half; i++) {
                int256 d = inData[i] - inData[half + i];
                loss += d.mul(d);
            }
            out[0] = div(loss, int256(int256(uint256(half)) * FixedPointMath.SCALE));
            return out;
        }
        if (opcode == CpuOpCodes.BACKWARD_SOFTMAX) {
            require(inData.length >= 2, "BWD_SOFTMAX");
            uint256 n = inData.length / 2;
            int256[] memory grad = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                grad[i] = inData[i] - inData[n + i];
            }
            return grad;
        }
        if (opcode == CpuOpCodes.BACKWARD_RELU) {
            require(inData.length >= 2, "BWD_RELU");
            uint256 n = inData.length / 2;
            int256[] memory grad = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                grad[i] = inData[n + i] > 0 ? inData[i] : int256(0);
            }
            return grad;
        }
        if (opcode == CpuOpCodes.BACKWARD_SIGMOID) {
            uint256 n = inData.length / 2;
            int256[] memory grad = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                int256 s = FixedPointMath.sigmoid(inData[n + i]);
                grad[i] = inData[i].mul(s.mul(FixedPointMath.SCALE - s));
            }
            return grad;
        }
        if (opcode == CpuOpCodes.BACKWARD_TANH) {
            uint256 n = inData.length / 2;
            int256[] memory grad = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                int256 t = FixedPointMath.tanh(inData[n + i]);
                grad[i] = inData[i].mul(FixedPointMath.SCALE - t.mul(t));
            }
            return grad;
        }
        if (opcode == CpuOpCodes.BACKWARD_GELU) {
            uint256 n = inData.length / 2;
            int256[] memory grad = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                grad[i] = inData[i].mul(inData[n + i] > 0 ? FixedPointMath.SCALE : int256(0));
            }
            return grad;
        }
        if (opcode == CpuOpCodes.BACKWARD_MATMUL) {
            require(inShape.length >= 2 && outShape.length >= 2, "BWD_MATMUL shape");
            int256 noise = params.length > 0 ? params[0] : int256(0);
            int256[] memory dOut = new int256[](inData.length / 2);
            for (uint256 i = 0; i < dOut.length; i++) {
                dOut[i] = inData[i] + noise;
            }
            return TensorOps.transpose2d(dOut, inShape[0], inShape[1]);
        }
        revert("Gradient: bad opcode");
    }
}
