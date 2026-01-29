// frontend/src/App.tsx
import { useMemo, useRef, useState } from "react";
import "./App.css";

type Msg = {
  role: "user" | "bot";
  content: string;
  modelLabel?: string; // only for bot messages
  imageDataUrl?: string; // optional: for user messages with an image preview
  imageAlt?: string;
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

type ImageAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string; // raw base64 (no prefix)
  dataUrl: string; // for preview
  sizeBytes: number;
};

const MODELS: ModelOption[] = [
  { key: "trinity_large_preview_free", label: "Trinity Large Preview (free)" },
  { key: "solar_pro_3_free", label: "Solar Pro 3" },
  { key: "molmo_2_8b_free", label: "Molmo 2 8B (free, vision)" },
];

const MODEL_SUPPORTS_IMAGE: Record<string, boolean> = {
  molmo_2_8b_free: true,
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

function getModelLabel(key: string): string {
  return MODELS.find((m) => m.key === key)?.label ?? "Model";
}

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export default function App() {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default dropdown selection is Molmo 2 8B (free, vision)
  const [selectedModelKey, setSelectedModelKey] = useState<string>("molmo_2_8b_free");

  // Attachment state (composer-level)
  const [imageAttachment, setImageAttachment] = useState<ImageAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Multi-chat state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const activeChatSupportsImages = !!(activeChat && MODEL_SUPPORTS_IMAGE[activeChat.modelKey]);
  const hasImage = !!imageAttachment;

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
    setImageAttachment(null); // keep attachments scoped to the composer/chat
  }

  function openFilePicker() {
    setError(null);
    if (!activeChat) {
      setError("Create a chat first (+) and select a model.");
      return;
    }
    fileInputRef.current?.click();
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    // Allow selecting the same file again
    e.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please attach an image file (png/jpg/webp).");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is too large. Please use an image under 5MB.");
      return;
    }

    // Read as Data URL for preview and base64 extraction
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read the selected file."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });

    const base64 = dataUrlToBase64(dataUrl);

    setImageAttachment({
      name: file.name,
      mimeType: file.type,
      dataBase64: base64,
      dataUrl,
      sizeBytes: file.size,
    });
  }

  function removeAttachment() {
    setImageAttachment(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    if (!activeChat) {
      setError("Create a chat first (+) and select a model.");
      return;
    }

    // If an image is attached, only allow sending on image-capable models (Molmo)
    if (hasImage && !activeChatSupportsImages) {
      setError("Image input is only supported with Molmo. Create a Molmo chat to send images.");
      return;
    }

    setError(null);

    // Snapshot active chat and its model at send time
    const chatIdAtSend = activeChat.id;
    const modelKeyAtSend = activeChat.modelKey;
    const modelLabelAtSend = activeChat.modelLabel;
    const imageAtSend = imageAttachment;

    // Optimistically append user message to that chat
    setInput("");
    setImageAttachment(null);

    setChats((prev) =>
      prev.map((c) =>
        c.id === chatIdAtSend
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  role: "user",
                  content: text,
                  ...(imageAtSend ? { imageDataUrl: imageAtSend.dataUrl, imageAlt: imageAtSend.name } : {}),
                },
              ],
            }
          : c
      )
    );

    setIsSending(true);

    try {
      const body: any = { message: text, model: modelKeyAtSend };
      if (imageAtSend) {
        body.image = { mime_type: imageAtSend.mimeType, data_base64: imageAtSend.dataBase64 };
      }

      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t}`);
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

  const sendDisabled =
    isSending ||
    !activeChat ||
    !input.trim() ||
    (hasImage && !activeChatSupportsImages);

  const sendTitle = !activeChat
    ? "Create a chat first"
    : hasImage && !activeChatSupportsImages
      ? "Images are only supported with Molmo"
      : "Send message";

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
                  onClick={() => {
                    setActiveChatId(c.id);
                    setError(null);
                    setImageAttachment(null);
                  }}
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
                {MODEL_SUPPORTS_IMAGE[activeChat.modelKey] ? (
                  <div className="hintOk">This model supports image input.</div>
                ) : (
                  <div className="hint">This model is text-only.</div>
                )}
                No messages yet.
              </div>
            ) : (
              activeChat.messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="role">
                    <span className="badge">{m.role === "user" ? "You" : "Model"}</span>
                    <span>{m.role === "user" ? "User" : m.modelLabel ?? "Model"}</span>
                  </div>

                  {m.role === "user" && m.imageDataUrl && (
                    <div className="imgBubble" title={m.imageAlt ?? "attachment"}>
                      <img src={m.imageDataUrl} alt={m.imageAlt ?? "attachment"} />
                    </div>
                  )}

                  <div className="content">{m.content}</div>
                </div>
              ))
            )}
          </div>

          {/* Error */}
          {error && <div className="error">Hata: {error}</div>}

          {/* Composer */}
          <div className="composer">
            <div className="composerRow">
              <button
                className="iconBtn"
                onClick={openFilePicker}
                disabled={isSending || !activeChat}
                title={!activeChat ? "Create a chat first" : "Attach an image"}
                aria-label="Attach image"
                type="button"
              >
                📎
              </button>

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
                disabled={sendDisabled}
                title={sendTitle}
                type="button"
              >
                {isSending ? "Sending..." : "Send"}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="fileInput"
                onChange={onPickFile}
              />
            </div>

            {imageAttachment && (
              <div className={`attachmentRow ${activeChatSupportsImages ? "" : "attachmentRowWarn"}`}>
                <div className="attachmentPreview">
                  <img src={imageAttachment.dataUrl} alt={imageAttachment.name} />
                </div>
                <div className="attachmentMeta">
                  <div className="attachmentName">{imageAttachment.name}</div>
                  <div className="attachmentSub">
                    {imageAttachment.mimeType} • {(imageAttachment.sizeBytes / 1024).toFixed(0)} KB
                    {!activeChatSupportsImages && (
                      <span className="attachmentWarnText"> • Only Molmo can send images</span>
                    )}
                  </div>
                </div>
                <button className="iconBtn iconBtnDanger" onClick={removeAttachment} type="button" title="Remove">
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
