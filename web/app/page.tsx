"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/agent/ChatPanel";
import type {
  Architecture,
  ChatBlock,
  ChatThread,
} from "@/components/agent/types";
import { useWallet } from "../components/WalletProvider";
import { authorizeTraining } from "@/lib/wallet/authorize-training";
import type { WalletAuthResult } from "@/lib/wallet/authorize-training";

export default function HomePage() {
  const [architectures, setArchitectures] = useState<Architecture[]>([]);
  const [tierFilter, setTierFilter] = useState<string>("");
  const [architectureId, setArchitectureId] = useState("");
  const [useCase, setUseCase] = useState("");
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<ChatBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentPickedUseCase, setAgentPickedUseCase] = useState(false);
  const [agentPickedArch, setAgentPickedArch] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [acpStatus, setAcpStatus] = useState<{
    status?: string;
    progress_pct?: number;
    message?: string;
  } | null>(null);
  const { accountId, walletAuth, setWalletAuth } = useWallet();

  const selectedArch = architectures.find((a) => a.id === architectureId);

  const threadStorageKey = accountId ? `pocu_thread_id:${accountId}` : null;

  const loadThreads = useCallback(async () => {
    if (!accountId) {
      setThreads([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/threads?account_id=${encodeURIComponent(accountId)}`
      );
      if (res.ok) setThreads(await res.json());
    } catch {
      /* ignore */
    }
  }, [accountId]);

  const loadThread = useCallback(
    async (id: string) => {
      if (!accountId) return;
      try {
        const res = await fetch(
          `/api/threads/${id}?account_id=${encodeURIComponent(accountId)}`
        );
        if (!res.ok) {
          if (res.status === 404 && threadStorageKey) {
            localStorage.removeItem(threadStorageKey);
            setThreadId(null);
          }
          return;
        }
        const data = (await res.json()) as ChatThread & { messages?: ChatBlock[] };
        setThreadId(data.id);
        if (threadStorageKey) localStorage.setItem(threadStorageKey, data.id);
        setChat(data.messages ?? []);
        if (data.title) setUseCase(data.title);
      } catch {
        /* ignore */
      }
    },
    [accountId, threadStorageKey]
  );

  const startNewChat = useCallback(() => {
    setThreadId(null);
    if (threadStorageKey) localStorage.removeItem(threadStorageKey);
    setChat([]);
    setMessage("");
    setAgentPickedUseCase(false);
    setAgentPickedArch(false);
  }, [threadStorageKey]);

  const loadArchs = useCallback(async () => {
    const q = tierFilter ? `?tier=${tierFilter}` : "";
    const res = await fetch(`/api/architectures${q}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Architectures failed (${res.status})`);
    }
    const data = (await res.json()) as Architecture[];
    if (!Array.isArray(data)) {
      throw new Error("Invalid architectures response from agent");
    }
    setArchitectures(data);
    setAgentError(null);
  }, [tierFilter]);

  useEffect(() => {
    loadArchs().catch((e) => {
      setAgentError(
        e instanceof Error
          ? e.message
          : "Cannot load architectures — is the agent running on port 8000?"
      );
      setArchitectures([]);
    });
  }, [loadArchs]);

  useEffect(() => {
    if (!accountId) {
      setThreads([]);
      setThreadId(null);
      setChat([]);
      return;
    }
    void loadThreads();
    const saved = threadStorageKey
      ? localStorage.getItem(threadStorageKey)
      : null;
    if (saved) void loadThread(saved);
    else {
      setThreadId(null);
      setChat([]);
    }
  }, [accountId, loadThreads, loadThread, threadStorageKey]);

  function upsertAssistantBlock(updater: (block: ChatBlock) => ChatBlock) {
    setChat((c) => {
      const next = [...c];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = updater({ ...last });
      } else {
        next.push(updater({ role: "assistant" }));
      }
      return next;
    });
  }

  async function ensureWalletAuth(intent: string): Promise<WalletAuthResult | null> {
    if (!accountId) {
      setAgentError("Connect HashPack before starting training.");
      return null;
    }
    if (walletAuth) return walletAuth;
    try {
      setAgentError(null);
      const auth = await authorizeTraining(intent, (_step, statusMessage) => {
        setPipelineStatus(statusMessage);
      });
      setWalletAuth(auth);
      setPipelineStatus(null);
      return auth;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAgentError(msg);
      setPipelineStatus(null);
      return null;
    }
  }

  async function handleDatasetSelect(ref: string, title: string) {
    const intent = useCase || title;
    const auth = await ensureWalletAuth(intent);
    if (!auth) return;
    const prompt = `Use dataset "${ref}" (${title}). Inspect it, download, prepare, and start the training job.`;
    if (!loading) {
      void sendChat(prompt, auth);
    } else {
      setMessage(prompt);
    }
  }

  async function handleStartTraining(ref: string, title: string) {
    const intent = useCase || title;
    const auth = await ensureWalletAuth(intent);
    if (!auth) return;
    const prompt = `Yes, start training with dataset "${ref}" (${title}). Inspect it, download, prepare, and queue the job.`;
    if (!loading) {
      void sendChat(prompt, auth);
    } else {
      setMessage(prompt);
    }
  }

  function handleShowAlternatives() {
    const prompt = "Show me other dataset options for this use case.";
    if (!loading) {
      void sendChat(prompt);
    } else {
      setMessage(prompt);
    }
  }

  async function sendChat(overrideMessage?: string, authOverride?: WalletAuthResult) {
    const userMsg = (overrideMessage ?? message).trim();
    if (!userMsg) return;
    if (!overrideMessage) setMessage("");
    setChat((c) => [...c, { role: "user", text: userMsg }]);
    setLoading(true);
    setAgentError(null);
    setPipelineStatus(null);
    setAcpStatus(null);

    try {
      const history = threadId
        ? undefined
        : chat.flatMap((b) => {
            const parts: { role: string; content: string }[] = [];
            if (b.role === "user" && b.text) parts.push({ role: "user", content: b.text });
            if (b.role === "assistant" && b.text) {
              parts.push({ role: "assistant", content: b.text });
            }
            return parts;
          });

      const auth = authOverride ?? walletAuth;
      if (!accountId) {
        throw new Error("Connect your wallet before chatting.");
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          use_case: useCase,
          architecture_id: architectureId,
          thread_id: threadId,
          history,
          user_account_id: accountId,
          wallet_auth: auth
            ? {
                user_account_id: auth.user_account_id,
                mandate: auth.mandate,
                mandate_signature: auth.mandate_signature,
                allowance_tx_id: auth.allowance_tx_id,
                associate_tx_id: auth.associate_tx_id,
                initiation_tx_id: auth.initiation_tx_id,
                acp_order_id: auth.acp_order_id,
              }
            : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Chat failed (${res.status})`);
      }
      if (!res.body) {
        throw new Error("No response body from agent");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as {
              type: string;
              content?: string;
              message?: string;
              status?: string;
              progress_pct?: number;
              dataset?: ChatBlock["dataset"];
              datasets?: ChatBlock["datasets"];
              job?: ChatBlock["job"];
              use_case?: string;
              architecture_id?: string;
              auto?: boolean;
              thread_id?: string;
            };

            if (event.type === "status" && event.message) {
              setPipelineStatus(event.message);
              upsertAssistantBlock((block) => ({
                ...block,
                text: block.text ?? "",
              }));
            } else if (event.type === "acp_status") {
              setAcpStatus({
                status: event.status,
                progress_pct: event.progress_pct,
                message: event.message,
              });
              if (event.message) setPipelineStatus(event.message);
            } else if (event.type === "thread" && event.thread_id) {
              setThreadId(event.thread_id);
              if (threadStorageKey) {
                localStorage.setItem(threadStorageKey, event.thread_id);
              }
            } else if (event.type === "selection") {
              if (event.use_case) {
                setUseCase(event.use_case);
                setAgentPickedUseCase(Boolean(event.auto));
              }
              if (event.architecture_id) {
                setArchitectureId(event.architecture_id);
                setAgentPickedArch(Boolean(event.auto));
              }
            } else if (event.type === "text" && event.content) {
              upsertAssistantBlock((block) => ({
                ...block,
                text: (block.text ?? "") + event.content,
              }));
            } else if (event.type === "dataset" && event.dataset) {
              upsertAssistantBlock((block) => ({
                ...block,
                dataset: event.dataset,
                datasets: undefined,
              }));
            } else if (event.type === "datasets" && event.datasets?.length) {
              upsertAssistantBlock((block) => ({
                ...block,
                datasets: event.datasets,
                dataset: undefined,
              }));
            } else if (
              (event.type === "job" || event.type === "job_status") &&
              event.job
            ) {
              upsertAssistantBlock((block) => ({
                ...block,
                job: event.job,
              }));
            } else if (event.content) {
              upsertAssistantBlock((block) => ({
                ...block,
                text: (block.text ?? "") + event.content,
              }));
            }
          } catch {
            /* skip */
          }
        }
      }

      setChat((c) => {
        const last = c[c.length - 1];
        if (last?.role === "assistant") return c;
        return [...c, { role: "assistant", text: "No response from agent." }];
      });
    } catch (e) {
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: `Error: ${e instanceof Error ? e.message : e}`,
        },
      ]);
    } finally {
      setLoading(false);
      setPipelineStatus(null);
      void loadThreads();
    }
  }

  function handleThreadChange(id: string | null) {
    if (id) void loadThread(id);
    else startNewChat();
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ChatPanel
        agentError={agentError}
        threadId={threadId}
        threads={threads}
        useCase={useCase}
        agentPickedUseCase={agentPickedUseCase}
        agentPickedArch={agentPickedArch}
        tierFilter={tierFilter}
        architectureId={architectureId}
        architectures={architectures}
        selectedArch={selectedArch}
        chat={chat}
        message={message}
        loading={loading}
        pipelineStatus={pipelineStatus}
        acpProgressPct={acpStatus?.progress_pct}
        onThreadChange={handleThreadChange}
        onMessageChange={setMessage}
        onSend={() => void sendChat()}
        onUseCaseChange={(value) => {
          setUseCase(value);
          setAgentPickedUseCase(false);
        }}
        onClearUseCase={() => {
          setUseCase("");
          setAgentPickedUseCase(false);
        }}
        onPresetSelect={(chip) => {
          setUseCase(chip);
          setAgentPickedUseCase(false);
        }}
        onTierFilterChange={setTierFilter}
        onArchitectureSelect={(id) => {
          setArchitectureId(id);
          setAgentPickedArch(false);
        }}
        onClearArchitecture={() => {
          setArchitectureId("");
          setAgentPickedArch(false);
        }}
        onStartTraining={handleStartTraining}
        onShowAlternatives={handleShowAlternatives}
        onDatasetSelect={handleDatasetSelect}
      />
    </div>
  );
}
