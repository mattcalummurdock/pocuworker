"""Unit-style checks for HTS mint serial extraction helpers."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))

from hts_mint import HTS_NFT_METADATA_MAX_BYTES, _serials_from_receipt, build_nft_metadata_bytes  # noqa: E402


def main() -> None:
    assert _serials_from_receipt(SimpleNamespace(serials=[7])) == [7]
    assert _serials_from_receipt(SimpleNamespace(serial_numbers=[9])) == [9]
    assert _serials_from_receipt(SimpleNamespace(status="SUCCESS")) == []

    long_url = "https://example.supabase.co/storage/v1/object/sign/x" + ("a" * 200)
    meta = build_nft_metadata_bytes(
        {
            "id": "12d67c4c-e015-4c46-b316-4be904641bf3",
            "onchain_job_id": "0xc01e8d3857d19eec85613453c518c8410e0e98c7d3d8d05f2364eb4b04d599f9",
            "weights_hash": "0xabc123def456",
            "supabase_model_url": long_url,
            "ipfs_uri": "ipfs://bafkreibr7cyxmy4iyckmlyzige4ywccyygomwrcn4ldcldacw3nxe3ikgq",
        }
    )
    assert len(meta) <= HTS_NFT_METADATA_MAX_BYTES
    assert meta.decode().startswith("ipfs://")
    print("OK: HTS serial + metadata helper tests passed")


if __name__ == "__main__":
    main()
