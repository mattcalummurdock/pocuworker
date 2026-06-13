"""Verify ACP HCS publish uses Python SDK snake_case API. Run from repo root."""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))

from main import _load_hcs_topic_id, _publish_acp_order  # noqa: E402


def main() -> None:
    topic = _load_hcs_topic_id()
    if not topic:
        print("SKIP: no HCS topic in deployments/testnet.json")
        return
    order_id = str(uuid.uuid4())
    _publish_acp_order(
        topic,
        order_id,
        "wallet-flow-test",
        "test_mandate_hash",
        "0.0.9211283",
    )
    print(f"OK: ACP order published order_id={order_id} topic={topic}")


if __name__ == "__main__":
    main()
