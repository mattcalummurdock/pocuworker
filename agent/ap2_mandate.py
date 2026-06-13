from __future__ import annotations

import hashlib
import json
import time
from typing import Any

ALLOWANCE_HBAR = 200
MANDATE_TTL_SEC = 2 * 60 * 60


def build_ap2_mandate(
    *,
    intent: str,
    user_account_id: str,
    agent_account_id: str,
    budget_hbar: float = ALLOWANCE_HBAR,
) -> dict[str, Any]:
    now = int(time.time())
    return {
        "vct": "mandate.payment.open.1",
        "service": "train_ml_model",
        "intent": intent,
        "purpose": f"Authorize agent to spend up to {budget_hbar} HBAR for on-chain ML training",
        "budget": {"amount": budget_hbar, "currency": "HBAR"},
        "agent_account": agent_account_id,
        "user_account": user_account_id,
        "iat": now,
        "exp": now + MANDATE_TTL_SEC,
    }


def canonicalize_mandate(mandate: dict[str, Any]) -> str:
    ordered = {
        "agent_account": mandate["agent_account"],
        "budget": {
            "amount": mandate["budget"]["amount"],
            "currency": mandate["budget"]["currency"],
        },
        "exp": mandate["exp"],
        "iat": mandate["iat"],
        "intent": mandate["intent"],
        "purpose": mandate["purpose"],
        "service": mandate["service"],
        "user_account": mandate["user_account"],
        "vct": mandate["vct"],
    }
    return json.dumps(ordered, separators=(",", ":"))


def mandate_hash(mandate: dict[str, Any]) -> str:
    return hashlib.sha256(canonicalize_mandate(mandate).encode("utf-8")).hexdigest()


def is_mandate_expired(mandate: dict[str, Any], now_sec: int | None = None) -> bool:
    now = now_sec if now_sec is not None else int(time.time())
    return now >= int(mandate.get("exp", 0))
