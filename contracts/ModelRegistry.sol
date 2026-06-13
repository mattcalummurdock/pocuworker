// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Final model provenance for on-chain CPU jobs (cpuarc Layer 5).
/// @dev Weights live in manifest / HCS — only hashes on-chain (SSTORE gas).
contract ModelRegistry {
    struct CpuModel {
        bytes32 jobId;
        bytes32 dataHash;
        bytes32 txMatrixSnapshot;
        bytes32 programHash;
        bytes32 eventLogHash;
        bytes32 weightsHash;
        string hcsTopicId;
        string architecture;
        uint256 sampleCount;
        uint256 epochCount;
        address jobRegistry;
        bool committed;
    }

    mapping(bytes32 => CpuModel) public cpuModels;
    bytes32[] public allJobIds;

    event CpuModelCommitted(
        bytes32 indexed jobId,
        bytes32 dataHash,
        bytes32 programHash,
        bytes32 eventLogHash,
        bytes32 weightsHash,
        string hcsTopicId
    );

    function commitCpuModel(
        bytes32 jobId,
        bytes32 dataHash,
        bytes32 txMatrixSnapshot,
        bytes32 programHash,
        bytes32 eventLogHash,
        bytes32 weightsHash,
        string calldata hcsTopicId,
        string calldata architecture,
        uint256 sampleCount,
        uint256 epochCount,
        address jobRegistry
    ) external {
        require(!cpuModels[jobId].committed, "Already committed");
        require(weightsHash != bytes32(0), "Empty weights hash");

        cpuModels[jobId] = CpuModel({
            jobId: jobId,
            dataHash: dataHash,
            txMatrixSnapshot: txMatrixSnapshot,
            programHash: programHash,
            eventLogHash: eventLogHash,
            weightsHash: weightsHash,
            hcsTopicId: hcsTopicId,
            architecture: architecture,
            sampleCount: sampleCount,
            epochCount: epochCount,
            jobRegistry: jobRegistry,
            committed: true
        });

        allJobIds.push(jobId);
        emit CpuModelCommitted(
            jobId,
            dataHash,
            programHash,
            eventLogHash,
            weightsHash,
            hcsTopicId
        );
    }

    function weightsHashOf(bytes32 jobId) external view returns (bytes32) {
        return cpuModels[jobId].weightsHash;
    }

    function jobCount() external view returns (uint256) {
        return allJobIds.length;
    }
}
