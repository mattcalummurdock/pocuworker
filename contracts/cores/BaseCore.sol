// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IOnChainCpu.sol";
import "../interfaces/ICpuOpcodeSimulator.sol";
import "../libraries/TensorEvents.sol";
import "../libraries/TensorOps.sol";

/// @notice Base contract for all on-chain CPU cores.
abstract contract BaseCore is IOnChainCpu, ICpuOpcodeSimulator {
    using TensorOps for uint16[];

    address public jobRegistry;

    constructor(address _jobRegistry) {
        jobRegistry = _jobRegistry;
    }

    function simulateOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) external override returns (int256[] memory) {
        return _runOpcode(opcode, inShape, inData, outShape, params);
    }

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
    ) external virtual override {
        if (inShape.length > 0) {
            uint256 expected = TensorOps.numElements(inShape);
            if (expected == inData.length) {
                TensorOps.requireMatch(inShape, inData.length);
            }
        }
        bytes32 opHash = keccak256(
            abi.encode(jobId, hcsSeq, opcode, inShape, inData, outShape, params)
        );
        int256[] memory outData = _runOpcode(opcode, inShape, inData, outShape, params);
        TensorOps.requireMatch(outShape, outData.length);
        uint16[] memory shapeMem = outShape;
        TensorEvents.emitTensorCommitted(
            jobId,
            outTensorId,
            hcsSeq,
            messageHash,
            shapeMem,
            outData
        );
        TensorEvents.emitAck(jobId, hcsSeq, opHash, opcode, true);
    }

    function _runOpcode(
        uint8 opcode,
        uint16[] calldata inShape,
        int256[] calldata inData,
        uint16[] calldata outShape,
        int256[] calldata params
    ) internal virtual returns (int256[] memory);
}
