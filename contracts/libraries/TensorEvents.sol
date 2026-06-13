// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Tensor VRAM protocol — cpuarc Layer 4 (hash + IPFS off-chain bytes).
library TensorEvents {
    /// @dev Legacy full-data event (BaseCore single-op path when CPU_LEGACY_LOGS=1 off-chain only).
    event TensorEmitted(
        bytes32 indexed jobId,
        bytes32 indexed tensorId,
        uint64 hcsSeq,
        bytes32 messageHash,
        uint16 chunkIndex,
        uint16 chunkCount,
        uint16[] shape,
        int256[] data
    );

    /// @dev Phase B: on-chain compute proof via hash; full tensor pinned to IPFS off-chain.
    event TensorCommitted(
        bytes32 indexed jobId,
        bytes32 indexed tensorId,
        uint64 hcsSeq,
        bytes32 messageHash,
        uint16[] shape,
        bytes32 dataHash
    );

    event InstructionAck(
        bytes32 indexed jobId,
        uint64 hcsSeq,
        bytes32 opHash,
        uint8 opcode,
        bool success
    );

    function tensorDataHash(int256[] memory data) internal pure returns (bytes32) {
        return keccak256(abi.encode(data));
    }

    function emitTensorCommitted(
        bytes32 jobId,
        bytes32 tensorId,
        uint64 hcsSeq,
        bytes32 messageHash,
        uint16[] memory shape,
        int256[] memory data
    ) internal {
        emit TensorCommitted(
            jobId,
            tensorId,
            hcsSeq,
            messageHash,
            shape,
            tensorDataHash(data)
        );
    }

    function emitAck(
        bytes32 jobId,
        uint64 hcsSeq,
        bytes32 opHash,
        uint8 opcode,
        bool success
    ) internal {
        emit InstructionAck(jobId, hcsSeq, opHash, opcode, success);
    }
}
