import { useState } from "react";
import "./App.css";

type Msg = { role: "user" | "bot"; content: string };

export default function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsSending(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const data: { reply: string } = await res.json();
      setMessages((prev) => [...prev, { role: "bot", content: data.reply }]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setIsSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = gönder, Shift+Enter = yeni satır
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="container">
      <h1 className="title">Local Chat (Echo)</h1>

      <div className="chatlog">
        {messages.length === 0 ? (
          <div className="empty">Henüz mesaj yok.</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="role">{m.role === "user" ? "You" : "Bot"}</div>
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
          placeholder="Mesaj yaz..."
          rows={3}
          disabled={isSending}
        />
        <button onClick={handleSend} disabled={isSending || !input.trim()}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
