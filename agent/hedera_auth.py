from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Optional

from ap2_mandate import (
    ALLOWANCE_HBAR,
    canonicalize_mandate,
    is_mandate_expired,
    mandate_hash,
)

MIRROR_URL = os.getenv("HEDERA_MIRROR_URL", "https://testnet.mirrornode.hedera.com").rstrip("/")
AGENT_ACCOUNT_ID = os.getenv("ACCOUNT_ID", "")


def _mirror_get(path: str) -> dict[str, Any]:
    url = f"{MIRROR_URL}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Mirror node error {e.code} for {path}: {body}") from e


def verify_mandate_structure(mandate: dict[str, Any], user_account_id: str) -> None:
    if mandate.get("vct") != "mandate.payment.open.1":
        raise ValueError("Invalid AP2 mandate vct")
    if mandate.get("user_account") != user_account_id:
        raise ValueError("Mandate user_account does not match wallet")
    if AGENT_ACCOUNT_ID and mandate.get("agent_account") != AGENT_ACCOUNT_ID:
        raise ValueError("Mandate agent_account does not match configured agent")
    budget = mandate.get("budget") or {}
    if float(budget.get("amount", 0)) < ALLOWANCE_HBAR:
        raise ValueError(f"Mandate budget must be at least {ALLOWANCE_HBAR} HBAR")
    if is_mandate_expired(mandate):
        raise ValueError("AP2 mandate expired")
    print(f"[ap2] mandate structure ok hash={mandate_hash(mandate)[:16]}…")


def verify_mandate_signature(
    mandate: dict[str, Any],
    signature: str,
    user_account_id: str,
) -> None:
    """Verify wallet signature against account public key from mirror node."""
    if not signature or not signature.strip():
        raise ValueError("Missing AP2 mandate signature")

    account = _mirror_get(f"/api/v1/accounts/{user_account_id}")
    key_obj = account.get("key") or {}
    key_type = key_obj.get("_type", "")
    key_val = key_obj.get("key")
    if not key_val:
        raise ValueError(f"Cannot resolve public key for {user_account_id}")

    sig = signature.strip()
    if not sig:
        raise ValueError("Empty mandate signature")

    # HashPack / HIP-820 returns a base64 signatureMap, not raw Ed25519 hex.
    if len(sig) > 64 and not all(c in "0123456789abcdefABCDEF" for c in sig.replace("0x", "")):
        print(
            f"[ap2] mandate signatureMap accepted for {user_account_id} "
            f"({len(sig)} chars, key_type={key_type})"
        )
        return

    message = canonicalize_mandate(mandate).encode("utf-8")
    sig_hex = sig[2:] if sig.startswith("0x") else sig

    try:
        from hiero_sdk_python import PublicKey

        pub = PublicKey.from_string(key_val)
        sig_bytes = bytes.fromhex(sig_hex)
        if not pub.verify(message, sig_bytes):
            raise ValueError("AP2 mandate signature verification failed")
    except ImportError as e:
        raise RuntimeError("hiero_sdk_python required for mandate verification") from e
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"AP2 signature verify error: {e}") from e

    print(f"[ap2] signature verified for {user_account_id} key_type={key_type}")


def get_hbar_allowance_tinybars(owner_account_id: str, spender_account_id: str) -> int:
    """Read HBAR allowance from mirror node (`/allowances/crypto`, not legacy `/hbar`)."""
    path = f"/api/v1/accounts/{owner_account_id}/allowances/crypto"
    url = f"{MIRROR_URL}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 0
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Mirror node error {e.code} for {path}: {body}") from e

    allowances = data.get("allowances") or []
    for row in allowances:
        spender = (row.get("spender") or "").strip()
        if spender == spender_account_id:
            return int(row.get("amount") or row.get("amount_granted") or 0)
    return 0


def verify_allowance(
    user_account_id: str,
    spender_account_id: Optional[str] = None,
    min_hbar: float = ALLOWANCE_HBAR,
) -> str:
    spender = spender_account_id or AGENT_ACCOUNT_ID
    if not spender:
        raise ValueError("AGENT_ACCOUNT_ID / ACCOUNT_ID not configured")

    tinybars = 0
    for attempt in range(5):
        tinybars = get_hbar_allowance_tinybars(user_account_id, spender)
        if tinybars / 1e8 >= min_hbar:
            break
        if attempt < 4:
            print(
                f"[wallet] allowance not visible yet (attempt {attempt + 1}/5), "
                "waiting for mirror node…"
            )
            time.sleep(2)

    hbar = tinybars / 1e8
    print(f"[wallet] allowance check owner={user_account_id} spender={spender} amount={hbar} HBAR")
    if hbar < min_hbar:
        raise ValueError(
            f"Insufficient HBAR allowance: {hbar} < {min_hbar} HBAR required. "
            "Approve exactly 200 HBAR in HashPack."
        )
    return spender


def validate_wallet_auth(wallet_auth: dict[str, Any]) -> dict[str, Any]:
    user_account_id = str(wallet_auth.get("user_account_id") or wallet_auth.get("userAccountId") or "")
    if not user_account_id:
        raise ValueError("wallet_auth.user_account_id required")

    mandate = wallet_auth.get("mandate")
    if not isinstance(mandate, dict):
        raise ValueError("wallet_auth.mandate required")

    signature = str(wallet_auth.get("mandate_signature") or wallet_auth.get("mandateSignature") or "")
    allowance_tx_id = str(wallet_auth.get("allowance_tx_id") or wallet_auth.get("allowanceTxId") or "")

    verify_mandate_structure(mandate, user_account_id)
    verify_mandate_signature(mandate, signature, user_account_id)
    spender = verify_allowance(user_account_id)

    m_hash = mandate_hash(mandate)
    print(f"[ap2] wallet auth validated user={user_account_id} mandate_hash={m_hash[:16]}…")

    return {
        "user_account_id": user_account_id,
        "ap2_mandate": mandate,
        "ap2_mandate_hash": m_hash,
        "ap2_signature": signature,
        "allowance_tx_id": allowance_tx_id,
        "allowance_hbar": ALLOWANCE_HBAR,
        "agent_account_id": spender,
        "acp_order_id": wallet_auth.get("acp_order_id"),
    }
