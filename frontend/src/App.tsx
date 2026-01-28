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
      <h1 className="title">Local Chat</h1>

      {/* Top controls: + button on the left, dropdown on the right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <button
          onClick={createChat}
          disabled={isSending || chats.length >= 5}
          title={chats.length >= 5 ? "Max 5 chats" : "Create new chat"}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#111",
            color: "#fff",
            fontSize: 20,
            lineHeight: "20px",
            padding: 0,
          }}
        >
          +
        </button>

        <select
          value={selectedModelKey}
          onChange={(e) => setSelectedModelKey(e.target.value)}
          disabled={isSending}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            minWidth: 260,
          }}
        >
          {MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <div style={{ marginLeft: "auto", opacity: 0.75, fontSize: 12 }}>
          {activeChat ? `Active: ${activeChat.title} • ${activeChat.modelLabel}` : "No chat selected"}
        </div>
      </div>

      {/* Tabs row below controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {chats.map((c) => {
          const isActive = c.id === activeChatId;
          return (
            <button
              key={c.id}
              onClick={() => setActiveChatId(c.id)}
              disabled={isSending && isActive} // optional: keep active tab stable while sending
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid #ddd",
                background: isActive ? "#111" : "#fff",
                color: isActive ? "#fff" : "#111",
                cursor: "pointer",
              }}
              title={`Model: ${c.modelLabel}`}
            >
              {c.title}
            </button>
          );
        })}
      </div>

      <div className="chatlog">
        {!activeChat ? (
          <div className="empty">
            Create a chat with <b>+</b>, choose a model, then start messaging.
          </div>
        ) : activeChat.messages.length === 0 ? (
          <div className="empty">
            <div style={{ marginBottom: 6 }}>
              This chat uses: <b>{activeChat.modelLabel}</b>
            </div>
            No messages yet.
          </div>
        ) : (
          activeChat.messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="role">{m.role === "user" ? "You" : m.modelLabel ?? "Model"}</div>
              <div className="content">{m.content}</div>
            </div>
          ))
        )}
      </div>

      {error && <div className="error">Hata: {error}</div>}

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={activeChat ? "Mesaj yaz..." : "Önce + ile bir chat oluştur..."}
          rows={3}
          disabled={isSending || !activeChat}
        />
        <button onClick={handleSend} disabled={isSending || !activeChat || !input.trim()}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
