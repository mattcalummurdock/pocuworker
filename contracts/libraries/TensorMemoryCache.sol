// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Per-TX scratch tensors in memory only — zero SSTORE (hybrid log-only pattern).
library TensorMemoryCache {
    uint256 internal constant MAX_TENSORS = 96;

    struct Entry {
        bytes32 id;
        int256[] data;
        bool set;
    }

    struct Cache {
        uint256 len;
        Entry[MAX_TENSORS] entries;
    }

    function _find(Cache memory cache, bytes32 id) private pure returns (int256) {
        for (uint256 i = 0; i < cache.len; i++) {
            if (cache.entries[i].set && cache.entries[i].id == id) return int256(i);
        }
        return -1;
    }

    function get(Cache memory cache, bytes32 id) internal pure returns (int256[] memory) {
        int256 idx = _find(cache, id);
        require(idx >= 0, "Tensor not in cache");
        return cache.entries[uint256(idx)].data;
    }

    function put(Cache memory cache, bytes32 id, int256[] memory data)
        internal
        pure
        returns (Cache memory)
    {
        int256 idx = _find(cache, id);
        if (idx >= 0) {
            cache.entries[uint256(idx)].data = data;
            return cache;
        }
        require(cache.len < MAX_TENSORS, "Cache full");
        cache.entries[cache.len] = Entry({id: id, data: data, set: true});
        cache.len++;
        return cache;
    }

    function resolveInputs(
        Cache memory cache,
        bytes32[] calldata inputTensorIds,
        int256[] calldata literalData
    ) internal pure returns (int256[] memory) {
        return _resolveInputs(cache, inputTensorIds, literalData);
    }

    function resolveInputsMem(
        Cache memory cache,
        bytes32[] memory inputTensorIds,
        int256[] memory literalData
    ) internal pure returns (int256[] memory) {
        return _resolveInputsMem(cache, inputTensorIds, literalData);
    }

    function _resolveInputs(
        Cache memory cache,
        bytes32[] calldata inputTensorIds,
        int256[] calldata literalData
    ) private pure returns (int256[] memory) {
        if (inputTensorIds.length == 0) {
            int256[] memory lit = new int256[](literalData.length);
            for (uint256 i = 0; i < literalData.length; i++) lit[i] = literalData[i];
            return lit;
        }
        if (literalData.length > 0) {
            int256[] memory lit = new int256[](literalData.length);
            for (uint256 i = 0; i < literalData.length; i++) lit[i] = literalData[i];
            return lit;
        }
        return _concatCached(cache, inputTensorIds);
    }

    function _resolveInputsMem(
        Cache memory cache,
        bytes32[] memory inputTensorIds,
        int256[] memory literalData
    ) private pure returns (int256[] memory) {
        if (inputTensorIds.length == 0) return literalData;
        if (literalData.length > 0) return literalData;
        return _concatCachedMem(cache, inputTensorIds);
    }

    function _concatCached(Cache memory cache, bytes32[] calldata inputTensorIds)
        private
        pure
        returns (int256[] memory out)
    {
        uint256 totalLen;
        for (uint256 i = 0; i < inputTensorIds.length; i++) {
            totalLen += get(cache, inputTensorIds[i]).length;
        }
        out = new int256[](totalLen);
        uint256 o;
        for (uint256 i = 0; i < inputTensorIds.length; i++) {
            int256[] memory d = get(cache, inputTensorIds[i]);
            for (uint256 j = 0; j < d.length; j++) out[o++] = d[j];
        }
    }

    function _concatCachedMem(Cache memory cache, bytes32[] memory inputTensorIds)
        private
        pure
        returns (int256[] memory out)
    {
        uint256 totalLen;
        for (uint256 i = 0; i < inputTensorIds.length; i++) {
            totalLen += get(cache, inputTensorIds[i]).length;
        }
        out = new int256[](totalLen);
        uint256 o;
        for (uint256 i = 0; i < inputTensorIds.length; i++) {
            int256[] memory d = get(cache, inputTensorIds[i]);
            for (uint256 j = 0; j < d.length; j++) out[o++] = d[j];
        }
    }
}
