// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./libraries/FixedPointMath.sol";

contract TXHarvester {
    using FixedPointMath for int256;

    uint8 public constant MAX_NNZ = 16;

    uint256 public inputDim;
    mapping(uint256 => bytes32) public randomMatrix;
    mapping(uint256 => uint8) public nnzCount;
    mapping(uint256 => mapping(uint8 => uint8)) public nnzIndex;
    mapping(uint256 => mapping(uint8 => int256)) public nnzWeight;

    uint256 public harvestedCount;
    bytes32 public matrixSnapshot;

    event MatrixRowsAdded(uint256 totalCount, uint256 batchSize);

    constructor(uint256 _inputDim) {
        inputDim = _inputDim;
    }

    function harvestAll(bytes32[] calldata txHashes) external {
        require(txHashes.length > 0, "Empty harvest");
        _harvest(txHashes);
    }

    function harvestBatch(bytes32[] calldata txHashes) external {
        _harvest(txHashes);
    }

    function _harvest(bytes32[] calldata txHashes) internal {
        uint256 batchSize = txHashes.length;
        for (uint256 i = 0; i < batchSize; i++) {
            randomMatrix[harvestedCount] = txHashes[i];
            matrixSnapshot = keccak256(abi.encodePacked(matrixSnapshot, txHashes[i]));
            _buildSparseRow(harvestedCount, txHashes[i]);
            harvestedCount++;
        }
        emit MatrixRowsAdded(harvestedCount, batchSize);
    }

    function _buildSparseRow(uint256 rowIdx, bytes32 hash) internal {
        uint8 count = 0;
        for (uint256 i = 0; i < inputDim; i++) {
            bytes32 derived = keccak256(abi.encode(hash, i));
            uint8 selector = uint8(uint256(derived) >> 248);
            if (selector % 3 == 0) continue;
            int256 sign = int256(uint256(uint8(uint256(derived) >> 240) % 2)) * 2 - 1;
            nnzIndex[rowIdx][count] = uint8(i);
            nnzWeight[rowIdx][count] = sign * FixedPointMath.SCALE;
            count++;
        }
        nnzCount[rowIdx] = count;
    }

    function sparseDot(uint256 rowIdx, int256[] calldata x) external view returns (int256) {
        require(rowIdx < harvestedCount, "Row out of range");
        int256 sum = 0;
        uint8 count = nnzCount[rowIdx];
        for (uint8 k = 0; k < count; k++) {
            uint8 idx = nnzIndex[rowIdx][k];
            sum += nnzWeight[rowIdx][k].mul(x[idx]);
        }
        return sum;
    }

    function getProjectionRow(uint256 rowIdx, uint256 inputDim_) external view returns (int256[] memory) {
        require(rowIdx < harvestedCount, "Row out of range");
        int256[] memory row = new int256[](inputDim_);
        uint8 count = nnzCount[rowIdx];
        for (uint8 k = 0; k < count; k++) {
            uint8 idx = nnzIndex[rowIdx][k];
            if (idx < inputDim_) row[idx] = nnzWeight[rowIdx][k];
        }
        return row;
    }

    function getHash(uint256 rowIdx) external view returns (bytes32) {
        require(rowIdx < harvestedCount, "Row out of range");
        return randomMatrix[rowIdx];
    }

    function getMatrixSnapshot() external view returns (bytes32) {
        return matrixSnapshot;
    }
}
