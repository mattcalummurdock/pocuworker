// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseCore.sol";
import "../libraries/CpuOpCodes.sol";
import "../libraries/FixedPointMath.sol";

/// @title CoreE — Reductions, pooling, layer norm, tree ops (cpuarc Layer 2)
contract AggregationCore is BaseCore {
    using FixedPointMath for int256;

    constructor(address _jobRegistry) BaseCore(_jobRegistry) {}

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) internal pure override returns (int256[] memory) {
        if (opcode == CpuOpCodes.REDUCE_SUM) {
            int256[] memory out = new int256[](1);
            int256 s = 0;
            for (uint256 i = 0; i < inData.length; i++) s += inData[i];
            out[0] = s;
            return out;
        }
        if (opcode == CpuOpCodes.REDUCE_MEAN) {
            int256[] memory out = new int256[](1);
            int256 s = 0;
            for (uint256 i = 0; i < inData.length; i++) s += inData[i];
            out[0] = s / int256(uint256(inData.length));
            return out;
        }
        if (opcode == CpuOpCodes.MAXPOOL) {
            require(inShape.length >= 2 && params.length >= 2, "MAXPOOL");
            uint16 inH = inShape[0];
            uint16 inW = inShape[1];
            uint16 pH = uint16(uint256(params[0]));
            uint16 pW = uint16(uint256(params[1]));
            (int256[] memory pooled, , ) =
                FixedPointMath.maxPool2d(inData, inH, inW, pH, pW);
            inShape;
            outShape;
            return pooled;
        }
        if (opcode == CpuOpCodes.LAYERNORM) {
            int256 eps = params.length > 0 ? params[0] : int256(655);
            return FixedPointMath.layerNorm(inData, eps);
        }
        if (opcode == CpuOpCodes.HISTOGRAM) {
            require(params.length >= 1, "HISTOGRAM bins");
            uint16 bins = uint16(uint256(params[0]));
            int256[] memory hist = new int256[](bins);
            for (uint256 i = 0; i < inData.length; i++) {
                uint256 b = uint256(inData[i]) % bins;
                hist[b] += FixedPointMath.SCALE;
            }
            return hist;
        }
        if (opcode == CpuOpCodes.SPLIT_GAIN) {
            require(inData.length >= 4, "SPLIT_GAIN");
            int256 leftG = inData[0];
            int256 rightG = inData[1];
            int256 leftW = inData[2];
            int256 rightW = inData[3];
            int256[] memory out = new int256[](1);
            int256 total = leftW + rightW;
            if (total == 0) {
                out[0] = 0;
                return out;
            }
            int256 pL = FixedPointMath.div(leftW, total);
            int256 pR = FixedPointMath.div(rightW, total);
            int256 gParent = leftG + rightG;
            out[0] = gParent - leftG.mul(pL) - rightG.mul(pR);
            return out;
        }
        if (opcode == CpuOpCodes.LEAF_AGGREGATE) {
            require(inData.length >= 1, "LEAF_AGGREGATE");
            int256[] memory out = new int256[](1);
            int256 s = 0;
            for (uint256 i = 0; i < inData.length; i++) s += inData[i];
            out[0] = FixedPointMath.div(s, int256(int256(uint256(inData.length)) * FixedPointMath.SCALE));
            return out;
        }
        revert("Aggregation: bad opcode");
    }
}
