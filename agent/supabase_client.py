from __future__ import annotations

import json
import os
from typing import Any, Optional

from supabase import Client, create_client


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
    return create_client(url, key)


def create_job(row: dict[str, Any]) -> dict[str, Any]:
    sb = get_supabase()
    try:
        result = sb.table("training_jobs").insert(row).execute()
    except Exception as e:
        err = str(e)
        if "PGRST204" in err or "schema cache" in err.lower():
            raise RuntimeError(
                "training_jobs table is missing columns. Run docs/training-jobs-migration.sql "
                "in the Supabase SQL Editor, then retry."
            ) from e
        raise
    return result.data[0]


def get_job(job_id: str, user_account_id: str = "") -> Optional[dict[str, Any]]:
    sb = get_supabase()
    query = sb.table("training_jobs").select("*").eq("id", job_id)
    if user_account_id:
        query = query.eq("user_account_id", user_account_id)
    try:
        result = query.single().execute()
    except Exception:
        return None
    return result.data


def list_jobs(limit: int = 50, user_account_id: str = "") -> list[dict[str, Any]]:
    sb = get_supabase()
    query = sb.table("training_jobs").select("*")
    if user_account_id:
        query = query.eq("user_account_id", user_account_id)
    result = query.order("created_at", desc=True).limit(limit).execute()
    return result.data or []


# --- Chat persistence (uses base schema: title + content only) ---


def _encode_assistant_content(text: str, extra: Optional[dict[str, Any]] = None) -> str:
    payload: dict[str, Any] = dict(extra or {})
    if text:
        payload["text"] = text
    if len(payload) == 1 and "text" in payload:
        return payload["text"]
    if not payload:
        return ""
    return json.dumps(payload)


def _decode_message_content(role: str, content: str) -> tuple[str, dict[str, Any]]:
    if role != "assistant" or not content:
        return content or "", {}
    stripped = content.strip()
    if not stripped.startswith("{"):
        return content, {}
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError:
        return content, {}
    if not isinstance(data, dict):
        return content, {}
    text = str(data.pop("text", "") or "")
    return text, data


def create_thread(
    title: str,
    use_case: str = "",
    architecture_id: str = "",
    user_account_id: str = "",
) -> dict[str, Any]:
    sb = get_supabase()
    label = (use_case or title or "New chat")[:200]
    row: dict[str, Any] = {"title": label}
    if user_account_id:
        row["user_account_id"] = user_account_id
    result = sb.table("chat_threads").insert(row).execute()
    return result.data[0]


def update_thread(
    thread_id: str,
    *,
    title: Optional[str] = None,
    use_case: Optional[str] = None,
    architecture_id: Optional[str] = None,
) -> None:
    sb = get_supabase()
    patch: dict[str, Any] = {}
    if title is not None:
        patch["title"] = title[:200]
    elif use_case is not None:
        patch["title"] = use_case[:200]
    if patch:
        sb.table("chat_threads").update(patch).eq("id", thread_id).execute()


def list_threads(limit: int = 30, user_account_id: str = "") -> list[dict[str, Any]]:
    sb = get_supabase()
    query = sb.table("chat_threads").select("id, title, created_at, user_account_id")
    if user_account_id:
        query = query.eq("user_account_id", user_account_id)
    result = query.order("created_at", desc=True).limit(limit).execute()
    return result.data or []


def get_thread(thread_id: str, user_account_id: str = "") -> Optional[dict[str, Any]]:
    sb = get_supabase()
    query = (
        sb.table("chat_threads")
        .select("id, title, created_at, user_account_id")
        .eq("id", thread_id)
    )
    if user_account_id:
        query = query.eq("user_account_id", user_account_id)
    try:
        result = query.single().execute()
    except Exception:
        return None
    return result.data


def list_messages(thread_id: str) -> list[dict[str, Any]]:
    sb = get_supabase()
    result = (
        sb.table("chat_messages")
        .select("id, role, content, created_at")
        .eq("thread_id", thread_id)
        .order("created_at", desc=False)
        .execute()
    )
    return result.data or []


def save_message(
    thread_id: str,
    role: str,
    content: str,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    sb = get_supabase()
    stored = content
    if role == "assistant" and metadata:
        stored = _encode_assistant_content(content, metadata)
    row = {
        "thread_id": thread_id,
        "role": role,
        "content": stored,
    }
    result = sb.table("chat_messages").insert(row).execute()
    return result.data[0]


def messages_to_agent_history(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for row in messages:
        role = row.get("role", "user")
        if role not in ("user", "assistant"):
            continue
        if role == "assistant":
            text, _ = _decode_message_content(role, row.get("content") or "")
        else:
            text = row.get("content") or ""
        if text.strip():
            history.append({"role": role, "content": text})
    return history


def message_row_to_chat_block(row: dict[str, Any]) -> dict[str, Any]:
    role = row.get("role", "user")
    content = row.get("content") or ""
    if role == "user":
        return {"role": "user", "text": content}
    text, meta = _decode_message_content(role, content)
    block: dict[str, Any] = {"role": "assistant"}
    if text:
        block["text"] = text
    if meta.get("dataset"):
        block["dataset"] = meta["dataset"]
    if meta.get("datasets"):
        block["datasets"] = meta["datasets"]
    if meta.get("job"):
        block["job"] = meta["job"]
    return block
