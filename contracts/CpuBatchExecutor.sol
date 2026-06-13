// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./CpuJobRegistry.sol";
import "./interfaces/ICpuOpcodeSimulator.sol";
import "./libraries/TensorMemoryCache.sol";
import "./libraries/TensorEvents.sol";
import "./libraries/TensorOps.sol";
import "./libraries/BatchPacked.sol";

/// @notice Runs many CPU instructions in one TX — log-only tensors (events), memory scratch only.
/// @dev Aligns with hybridApproach.md: zero intermediate SSTORE; weights arrive via calldata refs.
contract CpuBatchExecutor {
    using TensorMemoryCache for TensorMemoryCache.Cache;

    CpuJobRegistry public immutable jobRegistry;

    struct BatchStep {
        bytes32 outTensorId;
        uint8 opcode;
        bytes32[] inputTensorIds;
        uint16[] inShape;
        int256[] literalData;
        uint16[] outShape;
        int256[] params;
    }

    event BatchPayloadCommitted(
        bytes32 indexed jobId,
        uint64 batchIndex,
        bytes32 batchHash,
        bytes32 payloadHash,
        uint16 stepCount
    );

    constructor(address _jobRegistry) {
        jobRegistry = CpuJobRegistry(_jobRegistry);
    }

    function executeBatch(
        bytes32 jobId,
        uint64 batchIndex,
        bytes32 batchHash,
        BatchStep[] calldata steps
    ) external {
        require(
            msg.sender == jobRegistry.dispatcher() || msg.sender == jobRegistry.owner(),
            "Not dispatcher"
        );

        TensorMemoryCache.Cache memory cache;
        for (uint256 i = 0; i < steps.length; i++) {
            BatchStep calldata step = steps[i];
            cache = _runStep(jobId, batchIndex, batchHash, i, cache, step.outTensorId, step.opcode, step.inputTensorIds, step.inShape, step.literalData, step.outShape, step.params);
        }
    }

    /// @notice Phase C: compact calldata + payload hash (IPFS/HCS audit off-chain).
    function executeBatchPacked(
        bytes32 jobId,
        uint64 batchIndex,
        bytes32 batchHash,
        bytes32 payloadHash,
        bytes calldata packed
    ) external {
        require(
            msg.sender == jobRegistry.dispatcher() || msg.sender == jobRegistry.owner(),
            "Not dispatcher"
        );

        BatchPacked.verifyPayload(packed, payloadHash);
        uint16 n = BatchPacked.stepCount(packed);
        emit BatchPayloadCommitted(jobId, batchIndex, batchHash, payloadHash, n);

        TensorMemoryCache.Cache memory cache;
        uint256 pos = BatchPacked.headerEnd(packed);
        for (uint256 i = 0; i < n; i++) {
            BatchPacked.StepView memory step;
            (step, pos) = BatchPacked.readStepAt(packed, pos);
            cache = _runStep(
                jobId,
                batchIndex,
                batchHash,
                i,
                cache,
                step.outTensorId,
                step.opcode,
                step.inputTensorIds,
                step.inShape,
                step.literalData,
                step.outShape,
                step.params
            );
        }
    }

    function _runStep(
        bytes32 jobId,
        uint64 batchIndex,
        bytes32 batchHash,
        uint256 stepIndex,
        TensorMemoryCache.Cache memory cache,
        bytes32 outTensorId,
        uint8 opcode,
        bytes32[] memory inputTensorIds,
        uint16[] memory inShape,
        int256[] memory literalData,
        uint16[] memory outShape,
        int256[] memory params
    ) private returns (TensorMemoryCache.Cache memory) {
        int256[] memory inData = cache.resolveInputsMem(inputTensorIds, literalData);

        if (inShape.length > 0) {
            uint256 expected = TensorOps.numElements(inShape);
            if (expected == inData.length) {
                TensorOps.requireMatch(inShape, inData.length);
            }
        }

        address core = jobRegistry.getCoreForOpcode(jobId, opcode);
        int256[] memory outData = ICpuOpcodeSimulator(core).simulateOpcode(
            opcode,
            inShape,
            inData,
            outShape,
            params
        );
        TensorOps.requireMatch(outShape, outData.length);

        cache = cache.put(outTensorId, outData);

        bytes32 opHash = keccak256(abi.encode(jobId, batchIndex, stepIndex, opcode, batchHash));
        TensorEvents.emitTensorCommitted(
            jobId,
            outTensorId,
            batchIndex,
            batchHash,
            outShape,
            outData
        );
        TensorEvents.emitAck(jobId, batchIndex, opHash, opcode, true);
        return cache;
    }
}
