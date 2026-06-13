from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, AsyncIterator, Optional

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_groq import ChatGroq

from tools_impl import (
    download_and_prepare,
    get_architecture,
    get_training_job_status,
    inspect_kaggle_dataset,
    list_architectures,
    pick_best_dataset,
    search_kaggle_for_use_case,
    search_kaggle_result,
    trigger_training_job,
)

# Hedera Agent Kit
HEDERA_TOOLS: list = []
_hedera_client = None

try:
    from hiero_sdk_python import AccountId, Client, Network, PrivateKey
    from hedera_agent_kit.langchain.toolkit import HederaLangchainToolkit
    from hedera_agent_kit.plugins import (
        core_account_query_plugin,
        core_consensus_plugin,
        core_token_plugin,
        core_token_query_plugin,
    )
    from hedera_agent_kit.shared.configuration import AgentMode, Configuration, Context

    account_id = AccountId.from_string(os.getenv("ACCOUNT_ID", "0.0.0"))
    pk = os.getenv("PRIVATE_KEY") or os.getenv("DER_ENCODED_PRIVATE_KEY", "")
    private_key = PrivateKey.from_string(pk)
    _hedera_client = Client(Network(network="testnet"))
    _hedera_client.set_operator(account_id, private_key)

    hedera_toolkit = HederaLangchainToolkit(
        client=_hedera_client,
        configuration=Configuration(
            tools=[],
            plugins=[
                core_account_query_plugin,
                core_consensus_plugin,
                core_token_plugin,
                core_token_query_plugin,
            ],
            context=Context(
                mode=AgentMode.AUTONOMOUS,
                account_id=str(account_id),
            ),
        ),
    )
    HEDERA_TOOLS = hedera_toolkit.get_tools()
    print(f"[agentkit] tools loaded: {len(HEDERA_TOOLS)}")
except Exception as e:
    print(f"[agent] Hedera Agent Kit init warning: {e}")


USE_CASE_CHIPS = [
    "Fraud detection",
    "Heart disease screening",
    "Customer churn",
    "Credit default risk",
    "Diabetes prediction",
    "Spam detection",
    "Demand forecasting",
    "Predictive maintenance",
]

DEFAULT_ARCHITECTURE_ID = "arch-mid-32-16"

SYSTEM_PROMPT = """You are an on-chain ML training coordinator for the Hedera CPU platform.

Rules:
- Every message includes the user's current USE CASE and ARCHITECTURE_ID. That IS their selection (manual or auto-inferred).
- If the user asks what they selected, what's configured, what they're building, etc. — answer in plain text from that context. DO NOT call any tools (especially NOT search_kaggle_datasets).
- When the user describes a new ML goal without picking UI controls, their selection was already inferred — confirm it briefly; a single recommended dataset may already be visible.
- search_kaggle_datasets list_mode must be the string "best" or "all" (never boolean). Use "all" ONLY when the user asks for other/different/alternative datasets.
- When the user names a dataset ref (owner/slug), do NOT search Kaggle — call inspect_kaggle_dataset_tool → download_and_prepare_dataset → trigger_training_job_tool.
- The user's ARCHITECTURE_ID must come from list_architectures — never invent layer sizes.
- Default training is always 2 samples and 1 epoch on Hedera testnet — always disclose this.
- Workflow for new goals: search_kaggle_datasets → inspect → download_and_prepare → trigger_training_job.
- After recommending a dataset, ask if they want to start training — do not dump a list unless they ask for alternatives.
- Use Hedera tools to check balance before training and submit HCS audit messages when appropriate.
- Return the job link immediately after trigger_training_job; never wait for training to finish.
- Only MLP tabular models are supported.
"""

_SELECTION_PATTERNS = [
    re.compile(r"what.*\b(selected|selection|choose|chosen|picked|pick)\b", re.I),
    re.compile(r"what do i have\b", re.I),
    re.compile(r"what('s| is) my\b", re.I),
    re.compile(r"what am i building\b", re.I),
    re.compile(r"summarize my\b", re.I),
    re.compile(r"current (setup|selection|config)\b", re.I),
    re.compile(r"what (use case|architecture)\b", re.I),
]


def _is_selection_question(message: str) -> bool:
    m = message.strip()
    if not m:
        return False
    return any(p.search(m) for p in _SELECTION_PATTERNS)


_ML_INTENT_PATTERNS = [
    re.compile(
        r"\b(build|train|create|make|develop|predict|detect|classify|forecast)\b", re.I
    ),
    re.compile(r"\b(model|classifier|predictor|detection|screening|churn|fraud)\b", re.I),
    re.compile(r"\b(find|search|browse|recommend|suggest|show)\b.*\b(dataset|data)\b", re.I),
    re.compile(
        r"\b(fraud|churn|diabetes|spam|credit|heart|maintenance|transaction|default)\b",
        re.I,
    ),
]


def _implies_ml_intent(message: str) -> bool:
    m = message.strip()
    if not m:
        return False
    return any(p.search(m) for p in _ML_INTENT_PATTERNS)


_CASUAL_GREETING_PATTERNS = [
    re.compile(r"^(hi|hello|hey|yo|howdy|greetings)\b[!?. ]*$", re.I),
    re.compile(r"^(good\s+(morning|afternoon|evening))\b[!?. ]*$", re.I),
]


def _is_casual_greeting(message: str) -> bool:
    m = message.strip()
    if not m:
        return False
    return any(p.match(m) for p in _CASUAL_GREETING_PATTERNS)


def _needs_inference(message: str, use_case: str, architecture_id: str) -> bool:
    if use_case.strip() and architecture_id.strip():
        return False
    if _is_casual_greeting(message):
        return False
    if len(message.strip()) < 12 and not _implies_ml_intent(message):
        return False
    return True


def _valid_architecture_id(architecture_id: str) -> str:
    try:
        get_architecture(architecture_id)
        return architecture_id
    except Exception:
        return DEFAULT_ARCHITECTURE_ID


def _parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


async def _infer_selection(
    message: str, partial_use_case: str, partial_architecture_id: str
) -> dict[str, str]:
    archs = list_architectures()
    arch_summary = [
        {
            "id": a["id"],
            "name": a["name"],
            "tier": a["tier"],
            "taskType": a["taskType"],
            "description": a.get("description", ""),
        }
        for a in archs
    ]
    llm = build_llm()
    response = await llm.ainvoke(
        [
            SystemMessage(
                content=(
                    "Infer the ML use case and on-chain CPU architecture for the user. "
                    "Respond with ONLY valid JSON: "
                    '{"use_case": "...", "architecture_id": "...", "reasoning": "one sentence"}'
                )
            ),
            HumanMessage(
                content=(
                    f"User message: {message}\n"
                    f"Preferred use-case labels (pick closest or paraphrase): {json.dumps(USE_CASE_CHIPS)}\n"
                    f"Already chosen use case (keep if set): {partial_use_case or 'none'}\n"
                    f"Already chosen architecture_id (keep if set): {partial_architecture_id or 'none'}\n"
                    f"Architecture catalog: {json.dumps(arch_summary)}\n\n"
                    "Rules:\n"
                    "- classification / fraud / churn / spam → cross_entropy mid-tier (arch-mid-32-16) unless low-tier requested\n"
                    "- regression / forecasting / demand → mse architecture (arch-low-mse-16 or arch-mid-mse-24-12)\n"
                    "- architecture_id MUST be an exact id from the catalog\n"
                    "- use_case should be a short product label (3–8 words)"
                )
            ),
        ]
    )
    try:
        data = _parse_json_object(str(response.content or ""))
    except (json.JSONDecodeError, TypeError):
        data = {}
    use_case = (partial_use_case or data.get("use_case") or message.strip()[:80]).strip()
    architecture_id = _valid_architecture_id(
        partial_architecture_id or data.get("architecture_id") or DEFAULT_ARCHITECTURE_ID
    )
    reasoning = str(data.get("reasoning") or "Inferred from your message.")
    return {
        "use_case": use_case,
        "architecture_id": architecture_id,
        "reasoning": reasoning,
    }


async def _resolve_selection(
    message: str, use_case: str, architecture_id: str
) -> tuple[str, str, bool, str]:
    uc = use_case.strip()
    aid = architecture_id.strip()
    if uc and aid:
        return uc, _valid_architecture_id(aid), False, ""
    inferred = await _infer_selection(message, uc, aid)
    resolved_uc = uc or inferred["use_case"]
    resolved_aid = _valid_architecture_id(aid or inferred["architecture_id"])
    changed = not (uc == resolved_uc and aid == resolved_aid)
    return resolved_uc, resolved_aid, changed, inferred.get("reasoning", "")


_ALTERNATIVE_DATASET_PATTERNS = [
    re.compile(r"\b(different|another|other|alternative)\b.*\b(dataset|option)", re.I),
    re.compile(r"\b(show|list|give)\b.*\b(other|more|all)\b.*\b(dataset|option)", re.I),
    re.compile(r"\bpick\s+(a\s+)?different\b", re.I),
    re.compile(r"\bother\s+datasets?\b", re.I),
    re.compile(r"\bmore\s+options?\b", re.I),
]


def _wants_alternative_datasets(message: str) -> bool:
    m = message.strip()
    if not m:
        return False
    return any(p.search(m) for p in _ALTERNATIVE_DATASET_PATTERNS)


def _should_auto_search(message: str, selection_was_inferred: bool) -> bool:
    if _is_selection_question(message):
        return False
    if selection_was_inferred and _implies_ml_intent(message):
        return True
    return bool(
        re.search(
            r"\b(search|find|browse|show|recommend|suggest)\b.*\b(dataset|data|kaggle)\b",
            message,
            re.I,
        )
    )


def _format_layers(arch: dict[str, Any]) -> str:
    layers = arch.get("layers") or []
    if not layers:
        return "—"
    return " → ".join(str(l["size"]) for l in layers)


def _build_selection_context(use_case: str, architecture_id: str) -> str:
    try:
        arch = get_architecture(architecture_id)
        return (
            f"Use case: {use_case}\n"
            f"Architecture: {arch['name']} ({architecture_id})\n"
            f"Tier: {arch['tier']} | Task: {arch['taskType']} | Optimizer: {arch['optimizer']} | Loss: {arch['loss']}\n"
            f"Hidden layers: {_format_layers(arch)} | Max features: {arch['maxInputDim']} | Max classes: {arch['maxNumClasses']}\n"
            f"Training defaults: 2 samples, 1 epoch on Hedera testnet (POC)"
        )
    except Exception:
        return (
            f"Use case: {use_case}\n"
            f"Architecture ID: {architecture_id}\n"
            f"Training defaults: 2 samples, 1 epoch on Hedera testnet (POC)"
        )


async def _answer_selection_question(
    message: str, use_case: str, architecture_id: str
) -> str:
    ctx = _build_selection_context(use_case, architecture_id)
    llm = build_llm()
    response = await llm.ainvoke(
        [
            SystemMessage(
                content=(
                    "The user is asking about their current UI selection. "
                    "Answer conversationally using ONLY the selection context below. "
                    "Do NOT mention searching Kaggle. Do NOT list datasets. "
                    "Confirm use case, architecture, and POC training limits (2 samples, 1 epoch)."
                )
            ),
            HumanMessage(content=f"{ctx}\n\nUser question: {message}"),
        ]
    )
    return str(response.content or ctx)


@tool
def list_architectures_tool(tier: Optional[str] = None) -> str:
    """List available on-chain CPU MLP architecture templates. Optional tier: low or mid."""
    return json.dumps(list_architectures(tier), indent=2)


@tool
def search_kaggle_datasets(
    use_case: str,
    search_query: Optional[str] = None,
    list_mode: str = "best",
) -> str:
    """Search Kaggle for CSV datasets. list_mode: 'best' (default, one match) or 'all' (full list when user wants alternatives)."""
    mode = (list_mode or "best").strip().lower()
    show_all = mode in ("all", "true", "yes", "1")
    return json.dumps(
        search_kaggle_result(use_case, search_query, show_all=show_all), indent=2
    )


@tool
def inspect_kaggle_dataset_tool(dataset_ref: str) -> str:
    """Inspect files and size of a Kaggle dataset before download."""
    return json.dumps(inspect_kaggle_dataset(dataset_ref), indent=2)


@tool
def download_and_prepare_dataset(
    dataset_ref: str,
    architecture_id: str,
    use_case: str,
    target_column: str = "",
) -> str:
    """Download Kaggle dataset and preprocess for the chosen architecture."""
    result = download_and_prepare(
        dataset_ref,
        architecture_id,
        use_case,
        target_column or None,
    )
    return json.dumps(result, indent=2)


@tool
def trigger_training_job_tool(
    use_case: str,
    architecture_id: str,
    dataset_ref: str,
    target_column: str,
    prepared_json: str,
    user_prompt: str = "",
) -> str:
    """Queue an on-chain training job. prepared_json is output from download_and_prepare_dataset."""
    prepared = json.loads(prepared_json)
    result = trigger_training_job(
        use_case,
        architecture_id,
        dataset_ref,
        target_column,
        prepared,
        user_prompt,
    )
    return json.dumps(result, indent=2)


@tool
def get_training_job(job_id: str) -> str:
    """Get status of a training job."""
    return json.dumps(get_training_job_status(job_id), indent=2)


CUSTOM_TOOLS = [
    list_architectures_tool,
    search_kaggle_datasets,
    inspect_kaggle_dataset_tool,
    download_and_prepare_dataset,
    trigger_training_job_tool,
    get_training_job,
]

ALL_TOOLS = CUSTOM_TOOLS + HEDERA_TOOLS


def build_llm() -> ChatGroq:
    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0.2,
    )


async def _pick_best_dataset_for_use_case(
    use_case: str, datasets: list[dict[str, Any]]
) -> dict[str, Any]:
    if len(datasets) <= 1:
        return datasets[0] if datasets else {}
    try:
        llm = build_llm()
        response = await llm.ainvoke(
            [
                SystemMessage(
                    content=(
                        "Pick the single most relevant Kaggle dataset for the use case. "
                        'Respond ONLY with JSON: {"ref": "owner/slug", "reason": "one sentence"}'
                    )
                ),
                HumanMessage(
                    content=(
                        f"Use case: {use_case}\n"
                        f"Candidates: {json.dumps(datasets, indent=2)}"
                    )
                ),
            ]
        )
        data = _parse_json_object(str(response.content or ""))
        ref = data.get("ref")
        for ds in datasets:
            if ds.get("ref") == ref:
                return ds
    except Exception:
        pass
    return pick_best_dataset(use_case, datasets)


def _emit_tool_ui(name: str, result: str) -> Optional[dict[str, Any]]:
    """Map tool JSON results to structured UI events."""
    try:
        data = json.loads(result)
    except json.JSONDecodeError:
        return None

    if name == "search_kaggle_datasets" and isinstance(data, dict):
        if data.get("mode") == "best" and data.get("dataset"):
            return {"type": "dataset", "dataset": data["dataset"]}
        if data.get("mode") == "list":
            return {"type": "datasets", "datasets": data.get("datasets", [])}
    if name == "search_kaggle_datasets" and isinstance(data, list) and data:
        return {"type": "dataset", "dataset": pick_best_dataset("", data)}
    if name == "inspect_kaggle_dataset_tool" and isinstance(data, dict):
        return {"type": "dataset_inspect", "inspect": data}
    if name == "trigger_training_job_tool" and isinstance(data, dict) and data.get("job_id"):
        return {"type": "job", "job": data}
    if name == "get_training_job" and isinstance(data, dict):
        return {"type": "job_status", "job": data}
    return None


def _normalize_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Map legacy / mistyped LLM tool args to the current schema."""
    normalized = dict(args)
    if name == "search_kaggle_datasets":
        if "list_mode" not in normalized and "show_all" in normalized:
            raw = normalized.pop("show_all")
            if isinstance(raw, bool):
                normalized["list_mode"] = "all" if raw else "best"
            else:
                normalized["list_mode"] = "all" if str(raw).lower() in ("true", "1", "yes", "all") else "best"
        elif "list_mode" in normalized and isinstance(normalized["list_mode"], bool):
            normalized["list_mode"] = "all" if normalized["list_mode"] else "best"
    return normalized


def _extract_dataset_ref(message: str) -> Optional[str]:
    quoted = re.search(r'["\']([a-z0-9_-]+/[a-z0-9_-]+)["\']', message, re.I)
    if quoted:
        return quoted.group(1)
    match = re.search(r"\b([a-z0-9_-]+/[a-z0-9_-]+)\b", message, re.I)
    return match.group(1) if match else None


def _is_train_pipeline_request(message: str) -> bool:
    if not _extract_dataset_ref(message):
        return False
    return bool(
        re.search(
            r"\b(inspect|download|prepare|queue|start(?:ing)?\s+training|training\s+job|train|use\s+this\s+dataset|use\s+dataset)\b",
            message,
            re.I,
        )
    )


async def _execute_train_pipeline(
    message: str,
    use_case: str,
    architecture_id: str,
    wallet_auth: Optional[dict[str, Any]] = None,
) -> AsyncIterator[dict[str, Any]]:
    dataset_ref = _extract_dataset_ref(message)
    if not dataset_ref:
        return

    if not wallet_auth:
        yield {
            "type": "text",
            "content": (
                "Connect HashPack and authorize training (200 HBAR allowance + AP2 mandate) "
                "before starting a training job."
            ),
        }
        return

    from cost_estimate import exceeds_allowance_cap
    from hedera_auth import validate_wallet_auth

    try:
        auth_fields = await asyncio.to_thread(validate_wallet_auth, wallet_auth)
    except Exception as e:
        yield {"type": "text", "content": f"Wallet authorization failed: {e}"}
        return

    if exceeds_allowance_cap(architecture_id, 2, 1):
        yield {
            "type": "text",
            "content": (
                f"Estimated training cost exceeds the {auth_fields['allowance_hbar']} HBAR allowance "
                f"for architecture `{architecture_id}`. Choose a smaller architecture."
            ),
        }
        return

    yield {
        "type": "text",
        "content": f"Starting training pipeline for `{dataset_ref}`…\n\n",
    }

    try:
        yield {
            "type": "acp_status",
            "order_id": None,
            "status": "PROCESSING",
            "progress_pct": 5,
            "message": "Inspecting dataset on Kaggle…",
        }
        yield {"type": "status", "message": "Inspecting dataset on Kaggle…"}
        inspect_data = await asyncio.to_thread(inspect_kaggle_dataset, dataset_ref)
        files = inspect_data.get("files") or []
        file_summary = ", ".join(f["name"] for f in files[:5]) or "—"
        yield {
            "type": "text",
            "content": (
                f"**Inspect:** {len(files)} file(s), "
                f"{inspect_data.get('total_mb', 0):.1f} MB total — {file_summary}\n\n"
            ),
        }

        if not inspect_data.get("ok", True):
            yield {
                "type": "text",
                "content": (
                    f"Dataset is too large ({inspect_data.get('total_mb', '?')} MB). "
                    "Pick a smaller Kaggle dataset."
                ),
            }
            return

        yield {
            "type": "acp_status",
            "status": "PROCESSING",
            "progress_pct": 10,
            "message": "Dataset found — downloading and preprocessing…",
        }
        yield {
            "type": "status",
            "message": "Downloading from Kaggle and preprocessing (may take a few minutes)…",
        }
        prepared = await asyncio.to_thread(
            download_and_prepare,
            dataset_ref,
            architecture_id,
            use_case,
            None,
        )
        yield {
            "type": "text",
            "content": (
                f"**Prepared:** {prepared.get('input_dim')} features, "
                f"target `{prepared.get('target_column')}`, "
                f"task {prepared.get('task_type')}\n\n"
            ),
        }
        yield {
            "type": "acp_status",
            "status": "PROCESSING",
            "progress_pct": 20,
            "message": "Queueing on-chain training job…",
        }
        yield {"type": "status", "message": "Queueing on-chain training job…"}
        job = await asyncio.to_thread(
            trigger_training_job,
            use_case,
            architecture_id,
            dataset_ref,
            prepared["target_column"],
            prepared,
            message,
            auth_fields,
        )
        yield {
            "type": "acp_status",
            "order_id": job.get("job_id"),
            "status": "PROCESSING",
            "progress_pct": 25,
            "message": "Training job queued — worker will execute on-chain batches",
        }
        job_event = _emit_tool_ui("trigger_training_job_tool", json.dumps(job))
        if job_event:
            yield job_event

        yield {
            "type": "text",
            "content": (
                f"Training job queued for **{dataset_ref}** "
                f"(2 samples, 1 epoch on Hedera testnet). "
                f"View progress at `/jobs/{job['job_id']}`."
            ),
        }
    except Exception as e:
        yield {"type": "text", "content": f"Training pipeline failed: {e}"}


async def _run_tool(fn: Any, args: dict[str, Any]) -> str:
    if asyncio.iscoroutinefunction(fn.invoke):
        return str(await fn.ainvoke(args))
    return str(await asyncio.to_thread(fn.invoke, args))


async def run_agent_chat(
    message: str,
    use_case: str,
    architecture_id: str,
    history: Optional[list[dict[str, str]]] = None,
    wallet_auth: Optional[dict[str, Any]] = None,
) -> AsyncIterator[dict[str, Any]]:
    had_full_selection = bool(use_case.strip() and architecture_id.strip())
    msg = message.strip()

    if _is_casual_greeting(msg):
        yield {
            "type": "text",
            "content": (
                "Hi! I'm your on-chain ML training agent. "
                "Tell me what you want to build — for example "
                "*fraud detection on credit card transactions* — and I'll pick a use case, "
                "architecture, and Kaggle dataset for you."
            ),
        }
        return

    resolved_use_case = use_case.strip()
    resolved_arch = architecture_id.strip()
    selection_changed = False
    reasoning = ""

    if _needs_inference(message, use_case, architecture_id):
        resolved_use_case, resolved_arch, selection_changed, reasoning = (
            await _resolve_selection(message, use_case, architecture_id)
        )
    else:
        resolved_use_case = resolved_use_case or "General tabular ML"
        resolved_arch = _valid_architecture_id(
            resolved_arch or DEFAULT_ARCHITECTURE_ID
        )

    if selection_changed:
        try:
            arch = get_architecture(resolved_arch)
            arch_name = arch["name"]
        except Exception:
            arch_name = resolved_arch
        yield {
            "type": "selection",
            "use_case": resolved_use_case,
            "architecture_id": resolved_arch,
            "architecture_name": arch_name,
            "reasoning": reasoning,
            "auto": not had_full_selection,
        }

    if _is_selection_question(message):
        text = await _answer_selection_question(
            message, resolved_use_case, resolved_arch
        )
        yield {"type": "text", "content": text}
        return

    if _is_train_pipeline_request(msg):
        train_arch = _valid_architecture_id(
            resolved_arch or architecture_id or DEFAULT_ARCHITECTURE_ID
        )
        train_uc = resolved_use_case or use_case or "Tabular ML"
        async for event in _execute_train_pipeline(
            message, train_uc, train_arch, wallet_auth
        ):
            yield event
        return

    if (
        not had_full_selection
        and len(message.strip()) < 12
        and not _implies_ml_intent(message)
    ):
        yield {
            "type": "text",
            "content": (
                "Describe what you want to build in the chat — for example "
                "'fraud detection on credit card transactions' — and I will pick a use case, "
                "architecture, and search Kaggle for you."
            ),
        }
        return

    try:
        arch = get_architecture(resolved_arch)
        arch_label = f"{arch['name']} ({resolved_arch})"
    except Exception:
        arch_label = resolved_arch

    if _wants_alternative_datasets(message):
        datasets = await asyncio.to_thread(
            search_kaggle_for_use_case, resolved_use_case
        )
        if datasets:
            yield {"type": "datasets", "datasets": datasets}
        intro = (
            f"**Use case:** {resolved_use_case}\n"
            f"**Architecture:** {arch_label}\n\n"
        )
        if datasets:
            intro += (
                f"Here are **{len(datasets)} alternative datasets** — pick one below, "
                "or tell me which to train on."
            )
        else:
            intro += "No alternative datasets found — try refining your use case."
        yield {"type": "text", "content": intro}
        return

    selection_was_inferred = not had_full_selection or selection_changed
    if _should_auto_search(message, selection_was_inferred):
        candidates = await asyncio.to_thread(
            search_kaggle_for_use_case, resolved_use_case
        )
        best: Optional[dict[str, Any]] = None
        if candidates:
            best = await _pick_best_dataset_for_use_case(resolved_use_case, candidates)
            yield {"type": "dataset", "dataset": best}
        intro = (
            f"**Use case:** {resolved_use_case}\n"
            f"**Architecture:** {arch_label}\n"
            f"**Training:** 2 samples, 1 epoch on Hedera testnet (POC)\n\n"
        )
        if best:
            title = best.get("title") or best.get("ref", "dataset")
            intro += (
                f"I found the best-matching Kaggle dataset for your goal: **{title}** "
                f"(`{best.get('ref', '')}`).\n\n"
                "Would you like to **start training** on this dataset? "
                "Say yes to proceed, or ask for a **different dataset** to see more options."
            )
        else:
            intro += "No Kaggle datasets matched yet — try refining the use case or search terms."
        yield {"type": "text", "content": intro}
        return

    selection_ctx = _build_selection_context(resolved_use_case, resolved_arch)
    llm = build_llm().bind_tools(ALL_TOOLS)
    messages: list = [SystemMessage(content=SYSTEM_PROMPT)]
    if history:
        for h in history:
            if h.get("role") == "user":
                messages.append(HumanMessage(content=h["content"]))
            elif h.get("role") == "assistant":
                messages.append(SystemMessage(content=h["content"]))
    user_content = (
        f"=== Current UI selection (authoritative) ===\n{selection_ctx}\n\n"
        f"User message: {message}\n\n"
        f"If the user is NOT asking to search/train, reply in text only — do not call tools."
    )
    messages.append(HumanMessage(content=user_content))

    tool_map = {t.name: t for t in ALL_TOOLS}
    max_steps = 12

    for _ in range(max_steps):
        response = await llm.ainvoke(messages)
        messages.append(response)

        if not getattr(response, "tool_calls", None):
            if response.content:
                yield {"type": "text", "content": response.content}
            return

        for tc in response.tool_calls:
            name = tc["name"]
            args = _normalize_tool_args(name, tc.get("args", {}))
            fn = tool_map.get(name)
            if not fn:
                result = f"Unknown tool: {name}"
            else:
                try:
                    result = await _run_tool(fn, args)
                except Exception as e:
                    result = f"Tool error: {e}"
            ui_event = _emit_tool_ui(name, str(result))
            if ui_event:
                yield ui_event
            messages.append(
                ToolMessage(content=str(result), tool_call_id=tc.get("id", name))
            )

        final = await llm.ainvoke(messages)
        messages.append(final)
        if final.content:
            yield {"type": "text", "content": final.content}
            return

    yield {
        "type": "text",
        "content": "Agent reached max tool steps. Check /jobs for status.",
    }
