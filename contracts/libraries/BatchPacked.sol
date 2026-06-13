// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Compact batch payload — lower calldata than ABI tuple[] executeBatch.
library BatchPacked {
    bytes4 internal constant MAGIC = 0x43505542; // "CPUB"
    uint8 internal constant VERSION = 1;

    error BadMagic();
    error BadVersion();
    error Truncated();
    error PayloadHashMismatch();

    struct StepView {
        bytes32 outTensorId;
        uint8 opcode;
        bytes32[] inputTensorIds;
        uint16[] inShape;
        int256[] literalData;
        uint16[] outShape;
        int256[] params;
    }

    function verifyPayload(bytes calldata packed, bytes32 expectedHash) internal pure {
        if (keccak256(packed) != expectedHash) revert PayloadHashMismatch();
    }

    function stepCount(bytes calldata packed) internal pure returns (uint16 n) {
        _header(packed);
        n = _readU16(packed, 5);
    }

    function decodeStep(bytes calldata packed, uint256 stepIndex)
        internal
        pure
        returns (StepView memory step, uint256 nextOffset)
    {
        _header(packed);
        uint16 total = _readU16(packed, 5);
        require(stepIndex < total, "step oob");

        uint256 pos = 7;
        for (uint256 s = 0; s < stepIndex; s++) {
            pos = _skipStep(packed, pos);
        }
        (step, nextOffset) = _readStep(packed, pos);
    }

    /// @dev O(1) per step — use in executeBatchPacked loop (not decodeStep).
    function readStepAt(bytes calldata packed, uint256 pos)
        internal
        pure
        returns (StepView memory step, uint256 nextPos)
    {
        (step, nextPos) = _readStep(packed, pos);
    }

    function headerEnd(bytes calldata packed) internal pure returns (uint256) {
        _header(packed);
        return 7;
    }

    function _header(bytes calldata packed) private pure {
        if (packed.length < 7) revert Truncated();
        if (bytes4(packed[:4]) != MAGIC) revert BadMagic();
        if (uint8(packed[4]) != VERSION) revert BadVersion();
    }

    function _skipStep(bytes calldata packed, uint256 pos) private pure returns (uint256) {
        (, pos) = _readStep(packed, pos);
        return pos;
    }

    function _readStep(bytes calldata packed, uint256 pos)
        private
        pure
        returns (StepView memory step, uint256 nextPos)
    {
        if (pos + 34 > packed.length) revert Truncated();
        step.outTensorId = _readBytes32(packed, pos);
        pos += 32;
        step.opcode = uint8(packed[pos]);
        pos += 1;
        uint8 nIn = uint8(packed[pos]);
        pos += 1;

        step.inputTensorIds = new bytes32[](nIn);
        for (uint256 i = 0; i < nIn; i++) {
            if (pos + 32 > packed.length) revert Truncated();
            step.inputTensorIds[i] = _readBytes32(packed, pos);
            pos += 32;
        }

        if (pos + 1 > packed.length) revert Truncated();
        uint8 inShapeLen = uint8(packed[pos]);
        pos += 1;
        step.inShape = new uint16[](inShapeLen);
        for (uint256 i = 0; i < inShapeLen; i++) {
            if (pos + 2 > packed.length) revert Truncated();
            step.inShape[i] = _readU16(packed, pos);
            pos += 2;
        }

        if (pos + 4 > packed.length) revert Truncated();
        uint32 litLen = _readU32(packed, pos);
        pos += 4;
        step.literalData = new int256[](litLen);
        for (uint256 i = 0; i < litLen; i++) {
            if (pos + 32 > packed.length) revert Truncated();
            step.literalData[i] = int256(uint256(_readBytes32(packed, pos)));
            pos += 32;
        }

        if (pos + 1 > packed.length) revert Truncated();
        uint8 outShapeLen = uint8(packed[pos]);
        pos += 1;
        step.outShape = new uint16[](outShapeLen);
        for (uint256 i = 0; i < outShapeLen; i++) {
            if (pos + 2 > packed.length) revert Truncated();
            step.outShape[i] = _readU16(packed, pos);
            pos += 2;
        }

        if (pos + 1 > packed.length) revert Truncated();
        uint8 paramsLen = uint8(packed[pos]);
        pos += 1;
        step.params = new int256[](paramsLen);
        for (uint256 i = 0; i < paramsLen; i++) {
            if (pos + 32 > packed.length) revert Truncated();
            step.params[i] = int256(uint256(_readBytes32(packed, pos)));
            pos += 32;
        }

        nextPos = pos;
    }

    function _readBytes32(bytes calldata data, uint256 pos) private pure returns (bytes32 w) {
        assembly {
            w := calldataload(add(data.offset, pos))
        }
    }

    function _readU16(bytes calldata data, uint256 pos) private pure returns (uint16 v) {
        v = (uint16(uint8(data[pos])) << 8) | uint16(uint8(data[pos + 1]));
    }

    function _readU32(bytes calldata data, uint256 pos) private pure returns (uint32 v) {
        v = (uint32(uint8(data[pos])) << 24) |
            (uint32(uint8(data[pos + 1])) << 16) |
            (uint32(uint8(data[pos + 2])) << 8) |
            uint32(uint8(data[pos + 3]));
    }
}
