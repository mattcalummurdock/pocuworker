// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseCore.sol";
import "../libraries/CpuOpCodes.sol";
import "../libraries/FixedPointMath.sol";
import "../libraries/TensorOps.sol";

/// @title CoreD — Optimizers (cpuarc Layer 2). State emitted as tensor events, not SSTORE.
contract OptimizerCore is BaseCore {
    using FixedPointMath for int256;

    constructor(address _jobRegistry) BaseCore(_jobRegistry) {}

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata,
        int256[] calldata params
    ) internal pure override returns (int256[] memory) {
        if (opcode == CpuOpCodes.SGD) {
            require(inData.length >= 2 && params.length >= 1, "SGD needs grad+weight, lr");
            uint256 n = inData.length / 2;
            int256 lr = params[0];
            int256[] memory w = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                w[i] = inData[n + i] - lr.mul(inData[i]);
            }
            return w;
        }
        if (opcode == CpuOpCodes.ADAM) {
            require(inData.length >= 4 && inData.length % 4 == 0 && params.length >= 3, "ADAM");
            uint256 n = inData.length / 4;
            int256 lr = params[0];
            int256 b1 = params[1];
            int256 b2 = params[2];
            uint256 tStep = params.length > 3 ? uint256(uint256(params[3]) / 65536) : 1;
            if (tStep == 0) tStep = 1;
            int256 mCorr = FixedPointMath.biasCorrection(b1, tStep);
            int256 vCorr = FixedPointMath.biasCorrection(b2, tStep);
            int256[] memory w = new int256[](n);
            int256[] memory mOut = new int256[](n);
            int256[] memory vOut = new int256[](n);
            for (uint256 i = 0; i < n; i++) {
                int256 g = inData[i];
                int256 wOld = inData[n + i];
                int256 mPrev = inData[2 * n + i];
                int256 vPrev = inData[3 * n + i];
                int256 m = mPrev.mul(b1) + g.mul(FixedPointMath.SCALE - b1);
                int256 v = vPrev.mul(b2) + g.mul(g).mul(FixedPointMath.SCALE - b2);
                int256 mHat = m.mul(mCorr);
                int256 vHat = v.mul(vCorr);
                int256 denom = FixedPointMath.sqrt(vHat) + 655;
                w[i] = wOld - lr.mul(FixedPointMath.div(mHat, denom));
                mOut[i] = m;
                vOut[i] = v;
            }
            int256[] memory packed = new int256[](n * 4);
            for (uint256 i = 0; i < n; i++) {
                packed[i] = w[i];
                packed[n + i] = mOut[i];
                packed[2 * n + i] = vOut[i];
                packed[3 * n + i] = w[i];
            }
            return packed;
        }
        if (opcode == CpuOpCodes.RMSPROP) {
            require(inData.length >= 2 && inData.length % 2 == 0 && params.length >= 2, "RMSPROP");
            uint256 n = inData.length / 2;
            int256 lr = params[0];
            int256 rho = params[1];
            int256[] memory out = new int256[](n * 2);
            for (uint256 i = 0; i < n; i++) {
                int256 g = inData[i];
                int256 v = rho.mul(inData[n + i]) + (FixedPointMath.SCALE - rho).mul(g.mul(g));
                out[i] = inData[n + i] - lr.mul(FixedPointMath.div(g, FixedPointMath.sqrt(v) + 655));
                out[n + i] = v;
            }
            return out;
        }
        if (opcode == CpuOpCodes.LR_FROM_TIMESTAMP) {
            require(params.length >= 2, "LR_FROM_TIMESTAMP");
            int256 baseLr = params[0];
            int256 ts = params[1];
            int256 period = 1000 * FixedPointMath.SCALE;
            int256 phase = ts % period;
            int256[] memory out = new int256[](1);
            out[0] = baseLr.mul(
                FixedPointMath.SCALE - FixedPointMath.div(phase, period) / 2
            );
            return out;
        }
        revert("Optimizer: bad opcode");
    }
}
