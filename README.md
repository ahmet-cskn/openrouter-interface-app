# OpenRouter Client Chat Application

This project is a client chat application built on top of OpenRouter.
It allows users to send prompts and receive responses from three free models available through the OpenRouter API.

The application supports text-based chat as well as image-augmented prompts for models that support vision input.

The backend is developed using FastAPI, and the frontend is developed using React with TypeScript.

---

## Application Flow

The overall flow of the application is as follows:

- Choose a model from the dropdown and create a new chat with that model.
- Type a prompt into the chat box.
- If the selected model supports image input (among the available models, only Molmo does), an image can be attached alongside the prompt.
- Click Send to submit the request and receive the model’s response.

Up to five distinct chats can be created and maintained simultaneously.
Each chat is associated with a fixed model selected at creation time.

---

## Setup Instructions

### 1. Configure environment variables

First, the API key must be set to your own key.

In backend/.env , ensure that the following variable is set:

OPENROUTER_API_KEY=your_openrouter_api_key_here

---

### 2. Install backend dependencies

From the project root, run the following command to create a virtual environment and install backend dependencies:

cd backend && \
python3.13 -m venv .venv && \
source .venv/bin/activate && \
pip install -r requirements.txt

---

### 3. Start the backend server

In a separate terminal, start the FastAPI backend:

cd backend && \
source .venv/bin/activate && \
uvicorn main:app --reload --port 8000

The backend will be available at:

http://localhost:8000

---

### 4. Start the frontend application

In another terminal, start the React frontend:

cd frontend && \
npm install && \
npm run dev

The frontend will be available at:

http://localhost:5173

---

That’s it.
You can now open http://localhost:5173/ in your browser and start using the application.


## OpenTelemetry Tracing (Jaeger)

The backend uses **OpenTelemetry** to generate meaningful **traces and spans** for critical operations:

- Incoming API requests to the FastAPI backend (`POST /chat`)
- Outgoing HTTP calls from the backend to OpenRouter (`httpx`)
- A custom application-level span (`chat.handle`) to clearly represent a single chat request

These traces are exported to a locally running **Jaeger** instance via **OTLP**.

---

### 1) Start Jaeger locally (Docker)

From the project root (where `docker-compose.yml` is located):

```bash
docker compose up -d
```

This starts a **Jaeger all-in-one** container with OTLP enabled.

Jaeger UI will be available at:

- http://localhost:16686

---

### 2) Generate and view traces

1. Start the frontend and send a message through the UI.
2. Open Jaeger UI: http://localhost:16686
3. In the **Service** dropdown, select:

   `local-chat-backend`

4. Click **Find Traces**
5. Open any trace to inspect spans such as:
   - `POST /chat` (FastAPI auto-instrumentation)
   - `chat.handle` (custom application span)
   - `openrouter.call` / `HTTP POST` (outgoing OpenRouter request)

Each request to `/chat` results in a single trace that clearly shows the full request lifecycle.
