// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Job registry and core routing for the on-chain CPU (cpuarc Layer 3).
contract CpuJobRegistry {
    struct Job {
        bytes32 dataHash;
        string hcsTopicId;
        address linearCore;
        address activationCore;
        address gradientCore;
        address optimizerCore;
        address aggregationCore;
        bool active;
    }

    struct CoreAddresses {
        address linearCore;
        address activationCore;
        address gradientCore;
        address optimizerCore;
        address aggregationCore;
    }

    uint256 public constant MAX_MAT_DIM = 64;
    /// @dev Matches TensorOps.MAX_ELEMENTS (Adam 4× bundle for 64×64 weight mats).
    uint256 public constant MAX_TENSOR_ELEMENTS = 16384;
    uint256 public constant MAX_PROGRAM_INSTRUCTIONS = 10000;
    uint256 public constant MAX_TREE_DEPTH = 6;

    address public owner;
    address public dispatcher;

    mapping(bytes32 => Job) public jobs;
    bytes32[] public jobIds;

    event JobRegistered(bytes32 indexed jobId, bytes32 dataHash, string hcsTopicId);
    event DispatcherUpdated(address indexed dispatcher);
    event CoresUpdated(bytes32 indexed jobId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyDispatcher() {
        require(msg.sender == dispatcher || msg.sender == owner, "Not dispatcher");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setDispatcher(address _dispatcher) external onlyOwner {
        dispatcher = _dispatcher;
        emit DispatcherUpdated(_dispatcher);
    }

    function registerJob(
        bytes32 jobId,
        bytes32 dataHash,
        string calldata hcsTopicId,
        CoreAddresses calldata cores
    ) external onlyDispatcher {
        require(!jobs[jobId].active, "Job exists");
        jobs[jobId] = Job({
            dataHash: dataHash,
            hcsTopicId: hcsTopicId,
            linearCore: cores.linearCore,
            activationCore: cores.activationCore,
            gradientCore: cores.gradientCore,
            optimizerCore: cores.optimizerCore,
            aggregationCore: cores.aggregationCore,
            active: true
        });
        jobIds.push(jobId);
        emit JobRegistered(jobId, dataHash, hcsTopicId);
        emit CoresUpdated(jobId);
    }

    function getCoreForOpcode(bytes32 jobId, uint8 opcode)
        external
        view
        returns (address core)
    {
        Job storage j = jobs[jobId];
        require(j.active, "Unknown job");
        if (opcode >= 1 && opcode <= 9) return j.linearCore;
        if (opcode >= 16 && opcode <= 21) return j.activationCore;
        if (opcode >= 32 && opcode <= 39) return j.gradientCore;
        if (opcode >= 48 && opcode <= 51) return j.optimizerCore;
        if (opcode >= 64 && opcode <= 70) return j.aggregationCore;
        revert("Unknown opcode");
    }

    function jobCount() external view returns (uint256) {
        return jobIds.length;
    }
}
