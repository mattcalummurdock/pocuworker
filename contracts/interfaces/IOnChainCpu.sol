// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IOnChainCpu {
    function execute(
        bytes32 jobId,
        uint64 hcsSeq,
        bytes32 messageHash,
        bytes32 outTensorId,
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) external;
}
