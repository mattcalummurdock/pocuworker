// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./FixedPointMath.sol";

/// @notice Shared tensor shape helpers for on-chain CPU cores.
library TensorOps {
    using FixedPointMath for int256;

    /// @dev Adam outputs 4× weight length (w,m,v,w); 64×64 weights → 16384 elements.
    uint256 internal constant MAX_ELEMENTS = 16384;
    uint256 internal constant MAX_DIM = 64;

    function numElements(uint16[] memory shape) internal pure returns (uint256 n) {
        if (shape.length == 0) return 0;
        n = 1;
        for (uint256 i = 0; i < shape.length; i++) {
            n *= uint256(shape[i]);
            require(n <= MAX_ELEMENTS, "Tensor too large");
        }
    }

    function requireMatch(uint16[] memory shape, uint256 dataLen) internal pure {
        require(numElements(shape) == dataLen, "Shape/data mismatch");
    }

    function matmul2d(
        int256[] memory a,
        uint16 rowsA,
        uint16 colsA,
        int256[] memory b,
        uint16 colsB
    ) internal pure returns (int256[] memory c) {
        require(a.length == uint256(rowsA) * colsA, "Bad A");
        require(b.length == uint256(colsA) * colsB, "Bad B");
        c = new int256[](uint256(rowsA) * colsB);
        for (uint256 i = 0; i < rowsA; i++) {
            for (uint256 j = 0; j < colsB; j++) {
                int256 sum = 0;
                for (uint256 k = 0; k < colsA; k++) {
                    sum += a[i * colsA + k].mul(b[k * colsB + j]);
                }
                c[i * colsB + j] = sum;
            }
        }
    }

    function transpose2d(int256[] memory m, uint16 rows, uint16 cols)
        internal
        pure
        returns (int256[] memory t)
    {
        t = new int256[](m.length);
        for (uint256 i = 0; i < rows; i++) {
            for (uint256 j = 0; j < cols; j++) {
                t[j * rows + i] = m[i * cols + j];
            }
        }
    }

    function outer(int256[] memory a, int256[] memory b)
        internal
        pure
        returns (int256[] memory o)
    {
        o = new int256[](a.length * b.length);
        for (uint256 i = 0; i < a.length; i++) {
            for (uint256 j = 0; j < b.length; j++) {
                o[i * b.length + j] = a[i].mul(b[j]);
            }
        }
    }

    function addVec(int256[] memory a, int256[] memory b)
        internal
        pure
        returns (int256[] memory c)
    {
        require(a.length == b.length, "Add length");
        c = new int256[](a.length);
        for (uint256 i = 0; i < a.length; i++) c[i] = a[i] + b[i];
    }

    function subVec(int256[] memory a, int256[] memory b)
        internal
        pure
        returns (int256[] memory c)
    {
        require(a.length == b.length, "Sub length");
        c = new int256[](a.length);
        for (uint256 i = 0; i < a.length; i++) c[i] = a[i] - b[i];
    }

    function mulScalarVec(int256[] memory a, int256 s)
        internal
        pure
        returns (int256[] memory c)
    {
        c = new int256[](a.length);
        for (uint256 i = 0; i < a.length; i++) c[i] = a[i].mul(s);
    }

    function flatten(int256[] memory data) internal pure returns (int256[] memory f) {
        f = new int256[](data.length);
        for (uint256 i = 0; i < data.length; i++) f[i] = data[i];
    }
}
