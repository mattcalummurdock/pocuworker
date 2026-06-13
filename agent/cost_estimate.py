from __future__ import annotations

import json
import os
from pathlib import Path

ALLOWANCE_CAP_HBAR = float(os.getenv("ALLOWANCE_HBAR", "200"))
MPP_GAS_BUFFER_HBAR = float(os.getenv("MPP_GAS_BUFFER_HBAR", "15"))
JOB_COST_BUFFER_HBAR = float(os.getenv("JOB_COST_BUFFER_HBAR", "10"))

ARCH_PATH = Path(__file__).resolve().parent / "architectures.json"


def _load_arch(architecture_id: str) -> dict:
    archs = json.loads(ARCH_PATH.read_text(encoding="utf-8"))
    for a in archs:
        if a["id"] == architecture_id:
            return a
    raise ValueError(f"Unknown architecture: {architecture_id}")


def estimate_batch_count(architecture_id: str, samples: int, epochs: int) -> int:
    arch = _load_arch(architecture_id)
    layers = len(arch.get("layers") or [])
    ops_per_sample = 4 + layers * 6
    total_ops = max(1, samples * epochs * ops_per_sample)
    return max(1, (total_ops + 3) // 4)


def estimate_job_cost_hbar(architecture_id: str, samples: int, epochs: int) -> float:
    batches = estimate_batch_count(architecture_id, samples, epochs)
    return batches * MPP_GAS_BUFFER_HBAR + JOB_COST_BUFFER_HBAR


def exceeds_allowance_cap(architecture_id: str, samples: int, epochs: int) -> bool:
    return estimate_job_cost_hbar(architecture_id, samples, epochs) > ALLOWANCE_CAP_HBAR
