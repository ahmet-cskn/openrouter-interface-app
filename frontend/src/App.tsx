// frontend/src/App.tsx
import { useMemo, useState } from "react";
import "./App.css";

type Msg = {
  role: "user" | "bot";
  content: string;
  modelLabel?: string; // only for bot messages
};

type ModelOption = {
  key: string; // backend expects this key
  label: string; // UI label
};

type Chat = {
  id: string;
  index: number; // 1..5
  title: string; // "Chat 1", ...
  modelKey: string;
  modelLabel: string;
  messages: Msg[];
};

const MODELS: ModelOption[] = [
  { key: "trinity_large_preview_free", label: "Trinity Large Preview (free)" },
  { key: "solar_pro_3_free", label: "Solar Pro 3" },
  { key: "deepseek_r1_0528_free", label: "Deepseek R1 0528" },
];

function getModelLabel(key: string): string {
  return MODELS.find((m) => m.key === key)?.label ?? "Model";
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default dropdown selection is DeepSeek
  const [selectedModelKey, setSelectedModelKey] = useState<string>("deepseek_r1_0528_free");

  // Multi-chat state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  function createChat() {
    setError(null);

    if (chats.length >= 5) {
      setError("You can create up to 5 chats.");
      return;
    }

    const nextIndex = chats.length + 1; // Chat 1..5 (simple incremental)
    const modelLabel = getModelLabel(selectedModelKey);

    const newChat: Chat = {
      id: makeId(),
      index: nextIndex,
      title: `Chat ${nextIndex}`,
      modelKey: selectedModelKey,
      modelLabel,
      messages: [],
    };

    setChats((prev) => [...prev, newChat]);
    setActiveChatId(newChat.id);
    setInput("");
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    if (!activeChat) {
      setError("Create a chat first (+) and select a model.");
      return;
    }

    setError(null);

    // Snapshot active chat and its model at send time
    const chatIdAtSend = activeChat.id;
    const modelKeyAtSend = activeChat.modelKey;
    const modelLabelAtSend = activeChat.modelLabel;

    // Optimistically append user message to that chat
    setInput("");
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatIdAtSend
          ? { ...c, messages: [...c.messages, { role: "user", content: text }] }
          : c
      )
    );

    setIsSending(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: modelKeyAtSend }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const data: { reply: string } = await res.json();

      // Append bot message to the same chat (even if user switched tabs meanwhile)
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatIdAtSend
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { role: "bot", content: data.reply, modelLabel: modelLabelAtSend },
                ],
              }
            : c
        )
      );
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setIsSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = send, Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="container">
      <div className="shell">
        <header className="header">
          <div className="brand">
            <div className="titleWrap">
              <h1 className="title">OpenRouter Client App</h1>
              <div className="subtitle">FastAPI • React • OpenRouter</div>
            </div>
          </div>

          <div className="controls">
            <button
              className="btn btnPrimary btnIcon"
              onClick={createChat}
              disabled={isSending || chats.length >= 5}
              title={chats.length >= 5 ? "Max 5 chats" : "Create new chat"}
              aria-label="Create new chat"
            >
              +
            </button>

            <select
              className="select"
              value={selectedModelKey}
              onChange={(e) => setSelectedModelKey(e.target.value)}
              disabled={isSending}
              aria-label="Select model for new chats"
              title="Select a model for the next chat you create"
            >
              {MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>

            <div className="spacer" />
          </div>
        </header>

        <div className="body">
          {/* Tabs row */}
          <div className="tabs">
            {chats.map((c) => {
              const isActive = c.id === activeChatId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChatId(c.id)}
                  disabled={isSending && isActive} // keep active tab stable while sending
                  className={`tab ${isActive ? "tabActive" : ""}`}
                  title={`Model: ${c.modelLabel}`}
                >
                  {c.title}
                </button>
              );
            })}
          </div>

          {/* Chat log */}
          <div className="chatlog" aria-live="polite">
            {!activeChat ? (
              <div className="empty">
                Select a model from the dropdown, then click the <b>+</b> button to start a chat.
              </div>
            ) : activeChat.messages.length === 0 ? (
              <div className="empty">
                <div style={{ marginBottom: 8 }}>
                  This chat uses: <b>{activeChat.modelLabel}</b>
                </div>
                No messages yet.
              </div>
            ) : (
              activeChat.messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="role">
                    <span className="badge">{m.role === "user" ? "You" : "Model"}</span>
                    <span>{m.role === "user" ? "User" : m.modelLabel ?? "Model"}</span>
                  </div>
                  <div className="content">{m.content}</div>
                </div>
              ))
            )}
          </div>

          {/* Error */}
          {error && <div className="error">Hata: {error}</div>}

          {/* Composer */}
          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={activeChat ? "Mesaj yaz..." : "Create a chat first using the plus button at the top"}
              rows={3}
              disabled={isSending || !activeChat}
            />
            <button
              className="btn btnPrimary sendBtn"
              onClick={handleSend}
              disabled={isSending || !activeChat || !input.trim()}
              title={!activeChat ? "Create a chat first" : "Send message"}
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
