import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    raise RuntimeError("Missing OPENROUTER_API_KEY. Put it in backend/.env or export it.")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# We accept a short key from the frontend and map it to OpenRouter model IDs
MODEL_MAP = {
    "trinity_large_preview_free": "arcee-ai/trinity-large-preview:free",  # :contentReference[oaicite:3]{index=3}
    "solar_pro_3_free": "upstage/solar-pro-3:free",                       # :contentReference[oaicite:4]{index=4}
    "deepseek_r1_0528_free": "deepseek/deepseek-r1-0528:free",            # :contentReference[oaicite:5]{index=5}
}

DEFAULT_MODEL_KEY = "deepseek_r1_0528_free"

app = FastAPI(title="OpenRouter Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    model: str | None = None  # frontend sends a key (one of MODEL_MAP)

class ChatResponse(BaseModel):
    reply: str

@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    user_text = (req.message or "").strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="Empty message")

    model_key = req.model or DEFAULT_MODEL_KEY
    if model_key not in MODEL_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Allowed: {list(MODEL_MAP.keys())}",
        )

    model_id = MODEL_MAP[model_key]

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        # optional but nice to have:
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Local Chat App",
    }

    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": user_text}],
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(OPENROUTER_URL, headers=headers, json=payload)

        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text)

        data = r.json()
        reply = data["choices"][0]["message"]["content"]
        return ChatResponse(reply=reply)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="OpenRouter request timed out")
    except (KeyError, TypeError):
        raise HTTPException(status_code=502, detail=f"Unexpected OpenRouter response: {r.text}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Network error contacting OpenRouter: {e}")
