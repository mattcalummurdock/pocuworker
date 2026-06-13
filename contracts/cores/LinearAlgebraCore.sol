// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseCore.sol";
import "../libraries/CpuOpCodes.sol";
import "../libraries/FixedPointMath.sol";
import "../libraries/TensorOps.sol";
import "../TXHarvester.sol";
import "../libraries/TensorEvents.sol";

/// @title CoreA — Linear algebra (cpuarc Layer 2)
contract LinearAlgebraCore is BaseCore {
    using FixedPointMath for int256;
    using TensorOps for uint16[];

    TXHarvester public harvester;

    constructor(address _jobRegistry, address _harvester) BaseCore(_jobRegistry) {
        harvester = TXHarvester(_harvester);
    }

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) internal pure override returns (int256[] memory) {
        if (opcode == CpuOpCodes.MATMUL) {
            require(inShape.length == 2 && outShape.length == 2, "MATMUL shape");
            uint16 rowsA = inShape[0];
            uint16 colsA = inShape[1];
            uint16 colsB = outShape[1];
            uint256 lenA = uint256(rowsA) * colsA;
            uint256 lenB = uint256(colsA) * colsB;
            int256[] memory a = new int256[](lenA);
            int256[] memory b = new int256[](lenB);
            for (uint256 i = 0; i < lenA; i++) a[i] = inData[i];
            for (uint256 i = 0; i < lenB; i++) b[i] = inData[lenA + i];
            return TensorOps.matmul2d(a, rowsA, colsA, b, colsB);
        }
        if (opcode == CpuOpCodes.ADD) {
            require(inData.length % 2 == 0, "ADD pairs");
            uint256 half = inData.length / 2;
            int256[] memory a = new int256[](half);
            int256[] memory b = new int256[](half);
            for (uint256 i = 0; i < half; i++) {
                a[i] = inData[i];
                b[i] = inData[half + i];
            }
            return TensorOps.addVec(a, b);
        }
        if (opcode == CpuOpCodes.SUB) {
            require(params.length >= 1, "SUB needs split");
            uint256 half = inData.length / 2;
            int256[] memory a = new int256[](half);
            int256[] memory b = new int256[](half);
            for (uint256 i = 0; i < half; i++) {
                a[i] = inData[i];
                b[i] = inData[half + i];
            }
            return TensorOps.subVec(a, b);
        }
        if (opcode == CpuOpCodes.MUL_SCALAR) {
            require(params.length >= 1, "MUL_SCALAR needs scalar");
            return TensorOps.mulScalarVec(inData, params[0]);
        }
        if (opcode == CpuOpCodes.DOT) {
            require(inShape.length == 1 && outShape.length == 1 && outShape[0] == 1, "DOT shape");
            require(inData.length % 2 == 0, "DOT pairs");
            uint256 half = inData.length / 2;
            int256[] memory a = new int256[](half);
            int256[] memory b = new int256[](half);
            for (uint256 i = 0; i < half; i++) {
                a[i] = inData[i];
                b[i] = inData[half + i];
            }
            int256[] memory out = new int256[](1);
            out[0] = FixedPointMath.dot(a, b);
            return out;
        }
        if (opcode == CpuOpCodes.OUTER) {
            require(inShape.length == 2, "OUTER shape");
            uint16 rows = inShape[0];
            uint16 cols = inShape[1];
            require(inData.length == uint256(rows) + cols, "OUTER data");
            int256[] memory a = new int256[](rows);
            int256[] memory b = new int256[](cols);
            for (uint256 i = 0; i < rows; i++) a[i] = inData[i];
            for (uint256 i = 0; i < cols; i++) b[i] = inData[uint256(rows) + i];
            return TensorOps.outer(a, b);
        }
        if (opcode == CpuOpCodes.TRANSPOSE) {
            require(inShape.length == 2, "TRANSPOSE shape");
            return TensorOps.transpose2d(inData, inShape[0], inShape[1]);
        }
        if (opcode == CpuOpCodes.FLATTEN) {
            return TensorOps.flatten(inData);
        }
        if (opcode == CpuOpCodes.CONV2D) {
            require(inShape.length >= 3 && params.length >= 2, "CONV2D shape");
            uint16 inH = inShape[0];
            uint16 inW = inShape[1];
            uint16 kH = uint16(uint256(params[0]));
            uint16 kW = uint16(uint256(params[1]));
            uint256 kernelLen = uint256(kH) * kW;
            int256[] memory kernel = new int256[](kernelLen);
            uint256 imgLen = uint256(inH) * inW;
            int256[] memory img = new int256[](imgLen);
            for (uint256 i = 0; i < imgLen; i++) img[i] = inData[i];
            for (uint256 i = 0; i < kernelLen; i++) kernel[i] = inData[imgLen + i];
            (int256[] memory out, , ) = FixedPointMath.conv2dIm2col(img, inH, inW, kernel, kH, kW);
            return out;
        }
        revert("LinearAlgebra: bad opcode");
    }

    /// @notice Seed weight tensor from harvested TX row (parasitic compute).
    function initWeightFromHarvest(
        bytes32 jobId,
        uint64 hcsSeq,
        bytes32 messageHash,
        bytes32 outTensorId,
        uint256 rowIdx,
        uint16 inputDim,
        uint16 outDim
    ) external {
        int256[] memory row = harvester.getProjectionRow(rowIdx, inputDim);
        int256[] memory w = new int256[](uint256(inputDim) * outDim);
        for (uint16 j = 0; j < outDim; j++) {
            for (uint16 i = 0; i < inputDim; i++) {
                w[uint256(j) * inputDim + i] = row[i];
            }
        }
        uint16[] memory shape = new uint16[](2);
        shape[0] = outDim;
        shape[1] = inputDim;
        TensorEvents.emitTensorCommitted(jobId, outTensorId, hcsSeq, messageHash, shape, w);
    }
}
