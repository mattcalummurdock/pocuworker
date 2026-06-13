from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from agent_core import run_agent_chat
from job_worker_loop import start_background_worker
from supabase_client import (
    create_thread,
    get_job,
    get_thread,
    list_jobs,
    list_messages,
    list_threads,
    message_row_to_chat_block,
    messages_to_agent_history,
    save_message,
    update_thread,
)
from tools_impl import load_architectures

app = FastAPI(title="POCU Hedera Training Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class WalletAuthPayload(BaseModel):
    user_account_id: str
    mandate: dict[str, Any]
    mandate_signature: str
    allowance_tx_id: str = ""
    associate_tx_id: str = ""
    initiation_tx_id: str = ""
    acp_order_id: str = ""


class AuthorizeRequest(BaseModel):
    wallet_auth: WalletAuthPayload
    use_case: str = ""
    intent: str = ""


class ChatRequest(BaseModel):
    message: str
    use_case: str = ""
    architecture_id: str = ""
    thread_id: Optional[str] = None
    history: Optional[list[dict[str, str]]] = None
    user_account_id: str = ""
    wallet_auth: Optional[WalletAuthPayload] = None


class CreateThreadRequest(BaseModel):
    title: str = "New chat"
    use_case: str = ""
    architecture_id: str = ""
    user_account_id: str = ""


def _apply_sse_to_assistant(assistant: dict[str, Any], event: dict[str, Any]) -> None:
    etype = event.get("type")
    if etype == "status":
        return
    if etype == "text" and event.get("content"):
        assistant["text"] = (assistant.get("text") or "") + event["content"]
    elif etype == "dataset" and event.get("dataset"):
        assistant["dataset"] = event["dataset"]
        assistant.pop("datasets", None)
    elif etype == "datasets" and event.get("datasets"):
        assistant["datasets"] = event["datasets"]
        assistant.pop("dataset", None)
    elif etype == "job" and event.get("job"):
        assistant["job"] = event["job"]
    elif etype == "job_status" and event.get("job"):
        assistant["job"] = event["job"]
    elif etype == "acp_status":
        assistant["acp_status"] = {
            k: event.get(k)
            for k in ("order_id", "status", "progress_pct", "message")
            if event.get(k) is not None
        }


def _assistant_metadata(assistant: dict[str, Any]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if assistant.get("text"):
        meta["text"] = assistant["text"]
    if assistant.get("dataset"):
        meta["dataset"] = assistant["dataset"]
    if assistant.get("datasets"):
        meta["datasets"] = assistant["datasets"]
    if assistant.get("job"):
        meta["job"] = assistant["job"]
    if assistant.get("acp_status"):
        meta["acp_status"] = assistant["acp_status"]
    return meta


@app.on_event("startup")
def startup() -> None:
    if os.getenv("AGENT_EMBEDDED_WORKER", "").strip() in ("1", "true", "yes"):
        start_background_worker(interval_sec=15)
        print("[agent] Embedded job worker: ON (set AGENT_EMBEDDED_WORKER=0 if using npm run jobs:worker)")
    else:
        print("[agent] Ready — job processing is handled by npm run jobs:worker")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/architectures")
def architectures(tier: Optional[str] = None) -> list[dict[str, Any]]:
    archs = load_architectures()
    if tier:
        archs = [a for a in archs if a.get("tier") == tier]
    return archs


@app.get("/jobs")
def jobs(user_account_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
    if not user_account_id.strip():
        raise HTTPException(400, "user_account_id is required")
    try:
        return list_jobs(limit, user_account_id.strip())
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@app.get("/jobs/estimate-cost")
def estimate_cost(architecture_id: str, samples: int = 2, epochs: int = 1) -> dict[str, Any]:
    from cost_estimate import ALLOWANCE_CAP_HBAR, estimate_job_cost_hbar, exceeds_allowance_cap

    est = estimate_job_cost_hbar(architecture_id, samples, epochs)
    return {
        "architecture_id": architecture_id,
        "samples": samples,
        "epochs": epochs,
        "estimated_cost_hbar": est,
        "allowance_cap_hbar": ALLOWANCE_CAP_HBAR,
        "exceeds_cap": exceeds_allowance_cap(architecture_id, samples, epochs),
    }


@app.get("/jobs/{job_id}")
def job_detail(job_id: str, user_account_id: str = "") -> dict[str, Any]:
    if not user_account_id.strip():
        raise HTTPException(400, "user_account_id is required")
    job = get_job(job_id, user_account_id.strip())
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.post("/authorize")
async def authorize_training(req: AuthorizeRequest) -> dict[str, Any]:
    from hedera_auth import validate_wallet_auth
    from ap2_mandate import mandate_hash
    import uuid

    payload = req.wallet_auth.model_dump()
    auth = await asyncio.to_thread(validate_wallet_auth, payload)

    order_id = str(uuid.uuid4())
    intent = req.intent or req.use_case or "train_ml_model"
    topic_id = _load_hcs_topic_id()
    if topic_id:
        try:
            await asyncio.to_thread(
                _publish_acp_order,
                topic_id,
                order_id,
                intent,
                auth["ap2_mandate_hash"],
                auth["user_account_id"],
            )
        except Exception as e:
            print(f"[acp] order publish warning (auth still ok): {e}")

    return {
        "ok": True,
        "order_id": order_id,
        "user_account_id": auth["user_account_id"],
        "ap2_mandate_hash": auth["ap2_mandate_hash"],
        "allowance_hbar": auth["allowance_hbar"],
        **auth,
    }


@app.post("/jobs/{job_id}/mint-model-nft")
async def mint_model_nft_endpoint(job_id: str) -> dict[str, Any]:
    from hts_mint import mint_model_nft

    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") not in ("awaiting_nft", "running", "completed", "failed"):
        raise HTTPException(400, f"Job status {job.get('status')} cannot mint NFT")
    if job.get("status") == "failed" and not job.get("supabase_model_url"):
        raise HTTPException(400, "Job failed before model manifest was uploaded")

    try:
        result = await asyncio.to_thread(mint_model_nft, job)
        return {"ok": True, "job_id": job_id, **result}
    except Exception as e:
        from supabase_client import get_supabase

        sb = get_supabase()
        sb.table("training_jobs").update(
            {
                "status": "awaiting_nft",
                "error_message": f"NFT mint failed: {e}",
            }
        ).eq("id", job_id).execute()
        print(f"[hts] mint failed job={job_id}: {e}")
        raise HTTPException(500, str(e)) from e


def _load_hcs_topic_id() -> str:
    path = Path(__file__).resolve().parent.parent / "deployments" / "testnet.json"
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("hcsTopicId"):
            return data["hcsTopicId"]
    hcs = Path(__file__).resolve().parent.parent / "deployments" / "hcs.json"
    if hcs.is_file():
        return json.loads(hcs.read_text(encoding="utf-8")).get("topicId", "")
    return os.getenv("HCS_TOPIC_ID", "")


def _publish_acp_order(
    topic_id: str,
    order_id: str,
    intent: str,
    mandate_hash_val: str,
    user_account: str,
) -> None:
    from hiero_sdk_python import TopicId, TopicMessageSubmitTransaction
    from agent_core import _hedera_client

    if not _hedera_client:
        raise RuntimeError("Hedera client not initialized for ACP publish")

    body = json.dumps(
        {
            "type": "ACP_ORDER",
            "order_id": order_id,
            "service": "train_ml_model",
            "intent": intent,
            "budget_hbar": 200,
            "ap2_mandate_hash": mandate_hash_val,
            "status": "PENDING",
            "user_account": user_account,
        }
    )
    receipt = (
        TopicMessageSubmitTransaction()
        .set_topic_id(TopicId.from_string(topic_id))
        .set_message(body)
        .execute(_hedera_client)
    )
    print(
        f"[acp] order created order_id={order_id} topic={topic_id} status={receipt.status}"
    )


@app.get("/threads")
def threads(user_account_id: str = "", limit: int = 30) -> list[dict[str, Any]]:
    if not user_account_id.strip():
        raise HTTPException(400, "user_account_id is required")
    try:
        return list_threads(limit, user_account_id.strip())
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@app.post("/threads")
def create_thread_endpoint(req: CreateThreadRequest) -> dict[str, Any]:
    if not req.user_account_id.strip():
        raise HTTPException(400, "user_account_id is required")
    try:
        return create_thread(
            req.title,
            req.use_case,
            req.architecture_id,
            req.user_account_id.strip(),
        )
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@app.get("/threads/{thread_id}")
def thread_detail(thread_id: str, user_account_id: str = "") -> dict[str, Any]:
    if not user_account_id.strip():
        raise HTTPException(400, "user_account_id is required")
    try:
        thread = get_thread(thread_id, user_account_id.strip())
        if not thread:
            raise HTTPException(404, "Thread not found")
        messages = list_messages(thread_id)
        return {
            **thread,
            "messages": [message_row_to_chat_block(m) for m in messages],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    async def stream():
        thread_id = req.thread_id
        use_case = req.use_case.strip()
        architecture_id = req.architecture_id.strip()
        history: list[dict[str, str]] = list(req.history or [])
        user_account_id = (req.user_account_id or "").strip()
        if not user_account_id and req.wallet_auth:
            user_account_id = (req.wallet_auth.user_account_id or "").strip()
        if not user_account_id:
            yield {"type": "text", "content": "Error: Connect your wallet before chatting."}
            return

        try:
            yield {"type": "status", "message": "Agent received your message…"}

            if not thread_id:
                title = use_case or req.message[:80] or "New chat"
                thread = await asyncio.to_thread(
                    create_thread,
                    title,
                    use_case,
                    architecture_id,
                    user_account_id,
                )
                thread_id = thread["id"]
                yield {
                    "type": "thread",
                    "thread_id": thread_id,
                    "title": thread.get("title"),
                }
            else:
                existing = await asyncio.to_thread(
                    get_thread, thread_id, user_account_id
                )
                if not existing:
                    yield {"type": "text", "content": "Error: Thread not found"}
                    return
                if use_case or architecture_id:
                    await asyncio.to_thread(
                        update_thread,
                        thread_id,
                        use_case=use_case or None,
                        architecture_id=architecture_id or None,
                    )

            await asyncio.to_thread(save_message, thread_id, "user", req.message)

            prior = await asyncio.to_thread(list_messages, thread_id)
            db_history = messages_to_agent_history(prior[:-1])
            if db_history:
                history = db_history

            assistant: dict[str, Any] = {"text": ""}

            wallet_auth = req.wallet_auth.model_dump() if req.wallet_auth else None

            async for event in run_agent_chat(
                req.message,
                use_case,
                architecture_id,
                history,
                wallet_auth,
            ):
                if event.get("type") == "selection":
                    sel_uc = event.get("use_case")
                    sel_arch = event.get("architecture_id")
                    if sel_uc or sel_arch:
                        await asyncio.to_thread(
                            update_thread,
                            thread_id,
                            title=(sel_uc or use_case or req.message[:80])[:200],
                            use_case=sel_uc,
                            architecture_id=sel_arch,
                        )
                _apply_sse_to_assistant(assistant, event)
                yield event

            meta = _assistant_metadata(assistant)
            await asyncio.to_thread(
                save_message,
                thread_id,
                "assistant",
                assistant.get("text") or "",
                meta if meta else None,
            )
        except Exception as e:
            yield {"type": "text", "content": f"Error: {e}"}

    async def sse():
        async for event in stream():
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
