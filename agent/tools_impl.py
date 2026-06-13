from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from kaggle_client import download_dataset, inspect_dataset, search_datasets
from supabase_client import create_job, get_job, get_supabase, upload_job_prepared_files

REPO_ROOT = Path(__file__).resolve().parent.parent
ARCH_PATH = Path(__file__).resolve().parent / "architectures.json"


def load_architectures() -> list[dict[str, Any]]:
    return json.loads(ARCH_PATH.read_text(encoding="utf-8"))


def list_architectures(tier: Optional[str] = None) -> list[dict[str, Any]]:
    archs = load_architectures()
    if tier:
        archs = [a for a in archs if a.get("tier") == tier]
    return archs


def get_architecture(arch_id: str) -> dict[str, Any]:
    for a in load_architectures():
        if a["id"] == arch_id:
            return a
    raise ValueError(f"Unknown architecture: {arch_id}")


def search_kaggle_for_use_case(use_case: str, query: Optional[str] = None) -> list[dict[str, Any]]:
    q = query or use_case
    return search_datasets(q, max_results=5)


def pick_best_dataset(use_case: str, datasets: list[dict[str, Any]]) -> dict[str, Any]:
    if not datasets:
        raise ValueError("No datasets to rank")
    if len(datasets) == 1:
        return datasets[0]

    keywords = {
        w for w in re.findall(r"[a-z0-9]+", use_case.lower()) if len(w) > 2
    }

    def score(ds: dict[str, Any]) -> float:
        title = (ds.get("title") or "").lower()
        ref = (ds.get("ref") or "").lower()
        title_words = set(re.findall(r"[a-z0-9]+", f"{title} {ref}"))
        overlap = len(keywords & title_words)
        votes = float(ds.get("vote_count") or 0)
        usability = float(ds.get("usability_rating") or 0)
        downloads = float(ds.get("download_count") or 0)
        return overlap * 10_000 + usability * 1_000 + votes + downloads * 0.01

    return max(datasets, key=score)


def search_kaggle_result(
    use_case: str,
    query: Optional[str] = None,
    *,
    show_all: bool = False,
) -> dict[str, Any]:
    datasets = search_kaggle_for_use_case(use_case, query)
    if show_all or not datasets:
        return {"mode": "list", "datasets": datasets}
    return {"mode": "best", "dataset": pick_best_dataset(use_case, datasets)}


def inspect_kaggle_dataset(dataset_ref: str) -> dict[str, Any]:
    files = inspect_dataset(dataset_ref)
    total_mb = sum(f["size_mb"] for f in files)
    return {"files": files, "total_mb": total_mb, "ok": total_mb <= 500}


def _hardhat_bin() -> str:
    is_win = os.name == "nt"
    name = "hardhat.cmd" if is_win else "hardhat"
    path = REPO_ROOT / "node_modules" / ".bin" / name
    if path.is_file():
        return str(path)
    return "npx.cmd" if is_win else "npx"


def _parse_preprocess_json(stdout: str, stderr: str) -> dict[str, Any]:
    """Hardhat may log to stdout/stderr; find the JSON result line."""
    for stream in (stdout, stderr):
        if not stream:
            continue
        for line in reversed(stream.strip().splitlines()):
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict) and data.get("ok") is False:
                raise RuntimeError(data.get("error") or "Preprocess failed")
            return data
    out_tail = (stdout or "").strip()[-1000:]
    err_tail = (stderr or "").strip()[-1000:]
    raise RuntimeError(
        "Preprocess produced no JSON output "
        f"(stdout empty={not (stdout or '').strip()}, stderr empty={not (stderr or '').strip()}). "
        f"stdout tail: {out_tail!r} stderr tail: {err_tail!r}"
    )


def download_and_prepare(
    dataset_ref: str,
    architecture_id: str,
    use_case: str,
    target_column: Optional[str] = None,
    job_id: Optional[str] = None,
) -> dict[str, Any]:
    arch = get_architecture(architecture_id)
    jid = job_id if job_id and len(job_id) == 36 else str(uuid.uuid4())
    dl_dir = REPO_ROOT / "data" / "kaggle" / jid.replace("-", "")
    csv_path = download_dataset(dataset_ref, str(dl_dir))

    env = os.environ.copy()
    env["DATA_CSV_PATH"] = csv_path
    env["ARCHITECTURE_ID"] = architecture_id
    env["JOB_ID"] = jid
    env["MAX_TRAIN_SAMPLES"] = "2"
    if target_column:
        env["TARGET_COLUMN"] = target_column

    is_win = os.name == "nt"
    hardhat = _hardhat_bin()
    cmd = (
        [hardhat, "run", "scripts/preprocess-tabular.ts"]
        if hardhat.endswith(("hardhat", "hardhat.cmd"))
        else [hardhat, "hardhat", "run", "scripts/preprocess-tabular.ts"]
    )
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        shell=is_win and hardhat.startswith("npx"),
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "preprocess failed").strip()
        raise RuntimeError(f"Preprocess failed: {detail[-2000:]}")

    result = _parse_preprocess_json(proc.stdout or "", proc.stderr or "")
    return {
        "job_id": jid,
        "dataset_ref": dataset_ref,
        "use_case": use_case,
        "architecture_id": architecture_id,
        "csv_path": csv_path,
        "metadata_path": result["metadataPath"],
        "input_dim": result["inputDim"],
        "num_classes": result["numClasses"],
        "task_type": result["taskType"],
        "target_column": result["targetColumn"],
        "feature_columns": result["featureColumns"],
        "data_hash": result["dataHash"],
    }


def trigger_training_job(
    use_case: str,
    architecture_id: str,
    dataset_ref: str,
    target_column: str,
    prepared: dict[str, Any],
    user_prompt: str = "",
    wallet_auth: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    arch = get_architecture(architecture_id)
    job_uuid = prepared.get("job_id") or str(uuid.uuid4())
    manifest_path = f"output/{job_uuid}_manifest.json"

    row: dict[str, Any] = {
        "id": job_uuid,
        "status": "pending",
        "user_prompt": user_prompt,
        "use_case": use_case,
        "model_id": architecture_id,
        "architecture_id": architecture_id,
        "architecture_name": arch["name"],
        "architecture_tier": arch["tier"],
        "train_samples": 2,
        "train_epochs": 1,
        "kaggle_dataset_ref": dataset_ref,
        "kaggle_url": f"https://www.kaggle.com/datasets/{dataset_ref}",
        "target_column": target_column,
        "input_dim": prepared["input_dim"],
        "num_classes": prepared["num_classes"],
        "data_csv_path": prepared.get("csv_path"),
        "prepared_meta_path": prepared["metadata_path"],
        "manifest_path": manifest_path,
        "acp_order_id": (wallet_auth or {}).get("acp_order_id") or job_uuid,
        "acp_status": "PENDING",
        "acp_progress_pct": 0,
    }
    if wallet_auth:
        row.update(
            {
                "user_account_id": wallet_auth.get("user_account_id"),
                "ap2_mandate": wallet_auth.get("ap2_mandate"),
                "ap2_mandate_hash": wallet_auth.get("ap2_mandate_hash"),
                "ap2_signature": wallet_auth.get("ap2_signature"),
                "allowance_tx_id": wallet_auth.get("allowance_tx_id"),
                "allowance_hbar": wallet_auth.get("allowance_hbar", 200),
            }
        )
    created = create_job(row)
    try:
        upload_job_prepared_files(job_uuid, prepared["metadata_path"])
    except Exception as exc:
        err = f"Could not upload prepared data to Supabase storage: {exc}"
        print(f"[agent] ERROR: {err}")
        try:
            get_supabase().table("training_jobs").update(
                {
                    "status": "failed",
                    "error_message": err,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", job_uuid).execute()
        except Exception:
            pass
        raise RuntimeError(err) from exc
    return {
        "job_id": created["id"],
        "status": "pending",
        "message": "Training job queued (2 samples, 1 epoch). View /jobs/{id}",
        "manifest_path": manifest_path,
    }


def get_training_job_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        return {"error": "Job not found"}
    logs = str(job.get("logs") or "")
    if logs:
        job = dict(job)
        job["logs"] = logs[-400:] if len(logs) > 400 else logs
    return job
