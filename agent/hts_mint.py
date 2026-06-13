from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from supabase_client import get_supabase

MODEL_NFT_TOKEN_ID = os.getenv("MODEL_NFT_TOKEN_ID", "")
HTS_NFT_METADATA_MAX_BYTES = 100


def build_nft_metadata_bytes(job: dict[str, Any]) -> bytes:
    """HTS allows max 100 bytes per NFT metadata — store a short URI/CID pointer only."""
    ipfs_uri = str(job.get("ipfs_uri") or "").strip()
    if ipfs_uri:
        raw = ipfs_uri.encode("utf-8")
        if len(raw) <= HTS_NFT_METADATA_MAX_BYTES:
            return raw

    job_ref = str(job.get("onchain_job_id") or job.get("id") or "")
    weights = str(job.get("weights_hash") or "")
    wh = weights[2:18] if weights.startswith("0x") else weights[:16]
    compact = json.dumps(
        {"v": 1, "j": job_ref[2:18] if job_ref.startswith("0x") else job_ref[:16], "w": wh},
        separators=(",", ":"),
    )
    raw = compact.encode("utf-8")
    if len(raw) <= HTS_NFT_METADATA_MAX_BYTES:
        return raw

    minimal = json.dumps({"v": 1, "id": str(job.get("id", ""))[:32]}, separators=(",", ":"))
    raw = minimal.encode("utf-8")
    if len(raw) > HTS_NFT_METADATA_MAX_BYTES:
        raise RuntimeError(
            f"NFT metadata still {len(raw)} bytes after compaction (max {HTS_NFT_METADATA_MAX_BYTES})"
        )
    return raw


def _get_hedera_client():
    from hiero_sdk_python import AccountId, Client, Network, PrivateKey

    account_id = AccountId.from_string(os.getenv("ACCOUNT_ID", "0.0.0"))
    pk = (
        os.getenv("HEX_ENCODED_PRIVATE_KEY")
        or os.getenv("PRIVATE_KEY")
        or os.getenv("DER_ENCODED_PRIVATE_KEY", "")
    )
    if pk.startswith("0x"):
        private_key = PrivateKey.from_string_ecdsa(pk)
    else:
        private_key = PrivateKey.from_string(pk)
    client = Client(Network(network="testnet"))
    client.set_operator(account_id, private_key)
    return client, account_id, private_key


def _load_hcs_topic() -> str:
    deploy_path = os.path.join(os.path.dirname(__file__), "..", "deployments", "testnet.json")
    if os.path.isfile(deploy_path):
        data = json.loads(open(deploy_path, encoding="utf-8").read())
        if data.get("hcsTopicId"):
            return data["hcsTopicId"]
    hcs_path = os.path.join(os.path.dirname(__file__), "..", "deployments", "hcs.json")
    if os.path.isfile(hcs_path):
        data = json.loads(open(hcs_path, encoding="utf-8").read())
        return data.get("topicId", "")
    return os.getenv("HCS_TOPIC_ID", "")


def _publish_acp_complete(
    topic_id: str,
    order_id: str,
    deliverable: dict[str, Any],
    total_spent: float,
) -> Optional[str]:
    if not topic_id:
        return None
    try:
        from hiero_sdk_python import TopicId, TopicMessageSubmitTransaction

        client, _, _ = _get_hedera_client()
        body = json.dumps(
            {
                "type": "ACP_STATUS",
                "order_id": order_id,
                "status": "COMPLETE",
                "progress_pct": 100,
                "deliverable": deliverable,
                "total_spent_hbar": total_spent,
                "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
            }
        )
        submit_tx = (
            TopicMessageSubmitTransaction()
            .set_topic_id(TopicId.from_string(topic_id))
            .set_message(body)
        )
        receipt = submit_tx.execute(client)
        tx_id = str(submit_tx.transaction_id)
        print(f"[acp] order complete order_id={order_id} hcs_tx={tx_id} status={receipt.status}")
        return tx_id
    except Exception as e:
        print(f"[acp] HCS COMPLETE publish warning: {e}")
        return None


def _serials_from_receipt(receipt: Any) -> list[int]:
    for attr in ("serial_numbers", "serials"):
        raw = getattr(receipt, attr, None)
        if raw:
            return [int(x) for x in list(raw)]
    return []


def _serial_from_record(mint_tx: Any, client: Any, token_id: str) -> Optional[int]:
    try:
        record = mint_tx.get_record(client)
    except Exception:
        return None

    for attr in ("token_nft_transfers", "nft_transfers"):
        transfers = getattr(record, attr, None)
        if not transfers:
            continue
        for tr in transfers:
            tid = getattr(tr, "token_id", None) or getattr(tr, "tokenId", None)
            serial = getattr(tr, "serial_number", None) or getattr(tr, "serial", None)
            if tid is not None and str(tid) == token_id and serial is not None:
                return int(serial)
    return None


def _serial_from_mirror(tx_id: str, token_id: str) -> Optional[int]:
    mirror = os.getenv("HEDERA_MIRROR_URL", "https://testnet.mirrornode.hedera.com").rstrip("/")
    mirror_tx_id = tx_id.replace("@", "-")
    url = f"{mirror}/api/v1/transactions/{mirror_tx_id}"

    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for tx in data.get("transactions", []):
                for nt in tx.get("nft_transfers", []) or []:
                    if nt.get("token_id") == token_id and nt.get("serial_number") is not None:
                        return int(nt["serial_number"])
        except urllib.error.HTTPError as e:
            if e.code == 404 and attempt < 5:
                time.sleep(2)
                continue
            break
        except Exception:
            break
        time.sleep(2)
    return None


def _resolve_mint_serial(
    mint_tx: Any,
    client: Any,
    receipt: Any,
    token_id: str,
) -> int:
    serials = _serials_from_receipt(receipt)
    if serials:
        return serials[0]

    serial = _serial_from_record(mint_tx, client, token_id)
    if serial is not None:
        return serial

    tx_id = str(mint_tx.transaction_id)
    serial = _serial_from_mirror(tx_id, token_id)
    if serial is not None:
        return serial

    raise RuntimeError(
        f"TokenMint succeeded but no NFT serial found (tx={tx_id}). "
        "Check mirror node or SDK receipt fields."
    )


def mint_model_nft(job: dict[str, Any]) -> dict[str, Any]:
    token_id_str = MODEL_NFT_TOKEN_ID or job.get("model_nft_token_id")
    if not token_id_str:
        raise RuntimeError("MODEL_NFT_TOKEN_ID not set — run deploy-hts-model-collection.ts")

    user_account = job.get("user_account_id")
    if not user_account:
        raise ValueError("Job missing user_account_id for NFT transfer")

    job_id = str(job.get("id") or job.get("onchain_job_id") or "")
    print(f"[hts] agent minting for job={job_id} recipient={user_account}")

    from hiero_sdk_python import (
        AccountId,
        NftId,
        ResponseCode,
        TokenId,
        TokenMintTransaction,
        TransferTransaction,
    )

    client, operator_id, supply_key = _get_hedera_client()
    token_id = TokenId.from_string(token_id_str)
    recipient = AccountId.from_string(str(user_account))

    meta_bytes = build_nft_metadata_bytes(job)
    print(f"[hts] on-chain metadata ({len(meta_bytes)}B): {meta_bytes.decode('utf-8', errors='replace')}")

    mint_tx = (
        TokenMintTransaction()
        .set_token_id(token_id)
        .set_metadata([meta_bytes])
        .freeze_with(client)
    )
    mint_tx.sign(supply_key)
    mint_receipt = mint_tx.execute(client)
    status_name = getattr(ResponseCode(mint_receipt.status), "name", str(mint_receipt.status))
    if mint_receipt.status != ResponseCode.SUCCESS:
        raise RuntimeError(f"TokenMint failed: {status_name}")

    serial = _resolve_mint_serial(mint_tx, client, mint_receipt, token_id_str)
    print(f"[hts] mint serial={serial} token={token_id_str}")

    nft = NftId(token_id, serial)
    transfer_tx = (
        TransferTransaction()
        .add_nft_transfer(nft, operator_id, recipient)
        .freeze_with(client)
    )
    transfer_receipt = transfer_tx.execute(client)
    if transfer_receipt.status != ResponseCode.SUCCESS:
        raise RuntimeError(
            f"NFT transfer failed: {getattr(ResponseCode(transfer_receipt.status), 'name', transfer_receipt.status)}"
        )

    transfer_id = str(transfer_tx.transaction_id)
    print(f"[hts] transfer tx={transfer_id} → {user_account}")

    total_spent = float(job.get("total_spent_hbar") or job.get("mpp_total_spent_hbar") or 0)
    manifest = job.get("manifest") or {}
    if isinstance(manifest, dict) and manifest.get("mppTotalSpentHbar"):
        total_spent = float(manifest["mppTotalSpentHbar"])

    topic_id = job.get("hcs_topic_id") or _load_hcs_topic()
    order_id = str(job.get("acp_order_id") or job_id)
    hedera_proof = _publish_acp_complete(
        topic_id,
        order_id,
        {
            "model_nft": token_id_str,
            "model_nft_serial": serial,
            "manifest_url": job.get("supabase_model_url"),
            "hedera_proof": transfer_id,
        },
        total_spent,
    )

    sb = get_supabase()
    sb.table("training_jobs").update(
        {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "model_nft_token_id": token_id_str,
            "model_nft_serial": serial,
            "acp_status": "COMPLETE",
            "acp_progress_pct": 100,
            "total_spent_hbar": total_spent,
        }
    ).eq("id", job_id).execute()

    return {
        "model_nft_token_id": token_id_str,
        "model_nft_serial": serial,
        "transfer_tx_id": transfer_id,
        "hedera_proof": hedera_proof or transfer_id,
    }
