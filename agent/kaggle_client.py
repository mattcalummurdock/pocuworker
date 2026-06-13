"""Kaggle API client using KAGGLE_API_TOKEN only."""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

# Token must be set before kaggle import
_token = os.getenv("KAGGLE_API_TOKEN", "")
if _token:
    os.environ["KAGGLE_API_TOKEN"] = _token

from kaggle.api.kaggle_api_extended import KaggleApi  # noqa: E402


def _ensure_token_file() -> None:
    token = os.getenv("KAGGLE_API_TOKEN", "")
    if not token:
        return
    kaggle_dir = Path.home() / ".kaggle"
    kaggle_dir.mkdir(parents=True, exist_ok=True)
    access = kaggle_dir / "access_token"
    if not access.exists():
        access.write_text(token, encoding="utf-8")


def get_api() -> KaggleApi:
    _ensure_token_file()
    api = KaggleApi()
    api.authenticate()
    return api


def search_datasets(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    api = get_api()
    datasets = api.dataset_list(
        search=query,
        file_type="csv",
        sort_by="votes",
    )
    results = []
    for ds in list(datasets)[:max_results]:
        ref = getattr(ds, "ref", None) or str(ds)
        results.append(
            {
                "ref": ref,
                "title": getattr(ds, "title", ref),
                "vote_count": getattr(ds, "voteCount", 0),
                "download_count": getattr(ds, "downloadCount", 0),
                "usability_rating": getattr(ds, "usabilityRating", 0),
                "total_bytes": getattr(ds, "totalBytes", 0),
            }
        )
    return results


def inspect_dataset(dataset_ref: str) -> list[dict[str, Any]]:
    api = get_api()
    files = api.dataset_list_files(dataset_ref).files
    out = []
    for f in files:
        size = getattr(f, "totalBytes", 0) or 0
        out.append({"name": f.name, "size_mb": size / 1024 / 1024})
    return out


def download_dataset(dataset_ref: str, dest: str) -> str:
    api = get_api()
    Path(dest).mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            api.dataset_download_files(dataset_ref, path=dest, unzip=True)
            break
        except Exception as e:
            if "429" in str(e) and attempt < 2:
                time.sleep(60)
                continue
            raise
    for p in Path(dest).rglob("*.csv"):
        return str(p)
    raise FileNotFoundError(f"No CSV in downloaded dataset {dataset_ref}")
