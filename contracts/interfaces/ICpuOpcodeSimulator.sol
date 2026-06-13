// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Run one opcode without emitting events (used by CpuBatchExecutor).
interface ICpuOpcodeSimulator {
    function simulateOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) external returns (int256[] memory);
}
