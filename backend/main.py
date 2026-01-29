import os
import base64
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

# --- OpenTelemetry imports ---
from opentelemetry import trace
from opentelemetry.propagate import inject
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.trace import Status, StatusCode

load_dotenv()

# -------------------------
# OpenTelemetry configuration
# -------------------------
OTEL_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "local-chat-backend")
OTEL_EXPORTER_OTLP_ENDPOINT = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://localhost:4318/v1/traces",  # Jaeger OTLP HTTP endpoint
)

resource = Resource.create({"service.name": OTEL_SERVICE_NAME})
provider = TracerProvider(resource=resource)
trace.set_tracer_provider(provider)

span_exporter = OTLPSpanExporter(endpoint=OTEL_EXPORTER_OTLP_ENDPOINT)
provider.add_span_processor(BatchSpanProcessor(span_exporter))

tracer = trace.get_tracer(__name__)

# -------------------------
# App / OpenRouter settings
# -------------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    raise RuntimeError("Missing OPENROUTER_API_KEY. Put it in backend/.env or export it.")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MODEL_MAP = {
    "trinity_large_preview_free": "arcee-ai/trinity-large-preview:free",
    "solar_pro_3_free": "upstage/solar-pro-3:free",
    "deepseek_r1_0528_free": "deepseek/deepseek-r1-0528:free",
    "molmo_2_8b_free": "allenai/molmo-2-8b:free",
}

DEFAULT_MODEL_KEY = "molmo_2_8b_free"
IMAGE_CAPABLE_MODEL_KEYS = {"molmo_2_8b_free"}

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB

# -------------------------
# FastAPI app + instrumentation
# -------------------------
app = FastAPI(title="OpenRouter Chat API")

# Auto-instrument incoming requests + httpx outgoing calls
FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()

# CORS (adjust if your frontend origin differs)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# API Models
# -------------------------
class ImageInput(BaseModel):
    mime_type: str
    data_base64: str


class ChatRequest(BaseModel):
    message: str
    model: str | None = None
    image: ImageInput | None = None


class ChatResponse(BaseModel):
    reply: str


def _estimate_base64_bytes(b64: str) -> int:
    # Rough size: 3/4 of base64 length minus padding
    b64 = b64.strip()
    padding = b64.count("=")
    return max(0, (len(b64) * 3) // 4 - padding)


def _validate_image(img: ImageInput) -> None:
    if not img.mime_type or not img.mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid image mime_type")

    if not img.data_base64 or not img.data_base64.strip():
        raise HTTPException(status_code=400, detail="Empty image data")

    approx_bytes = _estimate_base64_bytes(img.data_base64)
    if approx_bytes > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large (max 5MB)")

    # Validate base64 formatting (do not keep decoded bytes in memory longer than needed)
    try:
        base64.b64decode(img.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image payload")


# -------------------------
# Routes
# -------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


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

    # Image enforcement (server-side)
    if req.image is not None and model_key not in IMAGE_CAPABLE_MODEL_KEYS:
        raise HTTPException(status_code=400, detail="This model does not support image input")

    model_id = MODEL_MAP[model_key]

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        # OpenRouter recommends identifying your app:
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Local Chat App",
    }

    # Build OpenRouter payload (OpenAI-compatible)
    if req.image is None:
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": user_text}],
        }
        has_image = False
    else:
        _validate_image(req.image)
        has_image = True
        data_url = f"data:{req.image.mime_type};base64,{req.image.data_base64}"
        payload = {
            "model": model_id,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }

    # Meaningful span for the critical operation (user interaction -> LLM call)
    with tracer.start_as_current_span("chat.handle") as span:
        span.set_attribute("chat.model_key", model_key)
        span.set_attribute("chat.model_id", model_id)
        span.set_attribute("chat.user_message_len", len(user_text))
        span.set_attribute("chat.has_image", has_image)
        if has_image and req.image is not None:
            span.set_attribute("chat.image_mime_type", req.image.mime_type)
            span.set_attribute("chat.image_bytes_est", _estimate_base64_bytes(req.image.data_base64))

        # Optional: propagate trace context downstream
        inject(headers)

        try:
            # Optional explicit child span (httpx instrumentation will also produce a span)
            with tracer.start_as_current_span("openrouter.call") as child:
                child.set_attribute("http.url", OPENROUTER_URL)
                child.set_attribute("openrouter.model", model_id)

                async with httpx.AsyncClient(timeout=30) as client:
                    r = await client.post(OPENROUTER_URL, headers=headers, json=payload)

                child.set_attribute("http.status_code", r.status_code)

            if r.status_code != 200:
                span.set_status(Status(StatusCode.ERROR))
                raise HTTPException(status_code=r.status_code, detail=r.text)

            data = r.json()
            reply = data["choices"][0]["message"]["content"]
            return ChatResponse(reply=reply)

        except httpx.TimeoutException:
            span.set_status(Status(StatusCode.ERROR))
            raise HTTPException(status_code=504, detail="OpenRouter request timed out")
        except (KeyError, TypeError):
            span.set_status(Status(StatusCode.ERROR))
            # r might not exist if error happened earlier; keep it safe
            raise HTTPException(status_code=502, detail="Unexpected OpenRouter response format")
        except httpx.RequestError as e:
            span.set_status(Status(StatusCode.ERROR))
            raise HTTPException(status_code=502, detail=f"Network error contacting OpenRouter: {e}")
