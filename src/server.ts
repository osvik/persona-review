import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPersonas, loadPersonaById, type Persona } from "./persona.js";
import {
  openConversation,
  runReviewLoop,
  runFollowUpTurn,
  closeConversation,
  DEFAULT_PROVIDER,
  PROVIDER_ENV_VARS,
  defaultModelForProvider,
  type PersonaConversation,
} from "./agent.js";
import { availableModelsFor } from "./cost.js";
import { loadUserDefaults, ensureUserDefaultsFile } from "./defaults.js";
import type { Provider } from "./llm/types.js";
import { lookupApiKey, USER_KEYS_PATH } from "./keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

interface ChatMessage {
  role: "user" | "persona";
  text: string;
  screenshot?: string;
  costUsd?: number;
}

interface WebSession {
  id: string;
  status: "idle" | "running" | "completed" | "failed";
  statusMessage: string;
  screenshot: string | null;
  error?: string;
  feedback?: any;
  conv?: PersonaConversation;
  logs: string[];
  messages: ChatMessage[];
  persona: Persona;
  url: string;
}

const sessions = new Map<string, WebSession>();

// Helper to get the latest screenshot from the conversation messages
function getLatestScreenshot(conv: PersonaConversation): string | null {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const msg = conv.messages[i];
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "image" && block.data) {
          return `data:${block.mediaType};base64,${block.data}`;
        }
      }
    }
  }
  if (conv.initialObservation && conv.initialObservation.screenshotBase64) {
    return `data:${conv.initialObservation.screenshotMediaType};base64,${conv.initialObservation.screenshotBase64}`;
  }
  return null;
}

// Config/Status Endpoint
app.get("/api/config", (req, res) => {
  const providers = ["anthropic", "openai", "google"] as const;
  const status: Record<string, { ready: boolean; envVar: string; defaultModel: string; models: string[] }> = {};

  for (const p of providers) {
    const envVar = PROVIDER_ENV_VARS[p];
    const keyLookup = lookupApiKey(envVar);
    status[p] = {
      ready: keyLookup.value !== undefined,
      envVar,
      defaultModel: defaultModelForProvider(p),
      models: availableModelsFor(p),
    };
  }

  res.json({
    providers: status,
    defaultProvider: DEFAULT_PROVIDER,
  });
});

// Personas Endpoint
app.get("/api/personas", async (req, res) => {
  try {
    const personas = await listPersonas();
    res.json(personas);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Start Review Endpoint
app.post("/api/review/start", async (req, res) => {
  const {
    personaId,
    url,
    provider,
    model,
    allowSubmit = false,
    allowCrossPageNavigation = false,
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const selectedProvider = (provider || DEFAULT_PROVIDER) as Provider;
  const reqKey = PROVIDER_ENV_VARS[selectedProvider];
  const keyLookup = lookupApiKey(reqKey);
  if (!keyLookup.value) {
    return res.status(400).json({
      error: `API key ${reqKey} is required for provider ${selectedProvider}. Please set it as an environment variable or add it to ${USER_KEYS_PATH}.`,
    });
  }

  try {
    const persona = await loadPersonaById(personaId);
    const sessionId = Math.random().toString(36).substring(2, 15);

    const session: WebSession = {
      id: sessionId,
      status: "running",
      statusMessage: "Initializing browser session...",
      screenshot: null,
      logs: ["Initializing browser session..."],
      messages: [],
      persona,
      url,
    };

    sessions.set(sessionId, session);

    // Run the review loop in the background
    (async () => {
      let conv: PersonaConversation | undefined;
      try {
        // Load default submit-data if allowSubmit is true
        let submitData;
        if (allowSubmit) {
          const { loadSubmitData } = await import("./submit-data.js");
          submitData = loadSubmitData(undefined); // loads default submit-data.yaml
        }

        conv = await openConversation(persona, url, {
          provider: selectedProvider,
          model,
          allowSubmit,
          allowCrossPageNavigation,
          submitData,
          onStatus: (msg) => {
            session.statusMessage = msg;
            session.logs.push(msg);
            if (conv) {
              session.screenshot = getLatestScreenshot(conv);
            }
          },
        });

        session.conv = conv;
        session.screenshot = getLatestScreenshot(conv);

        const review = await runReviewLoop(conv);
        session.status = "completed";
        session.statusMessage = "Review completed successfully.";
        session.feedback = review.feedback;
        session.logs.push("Review completed successfully.");
      } catch (err) {
        console.error("Review failed:", err);
        session.status = "failed";
        session.statusMessage = `Failed: ${(err as Error).message}`;
        session.error = (err as Error).message;
        session.logs.push(`Error: ${(err as Error).message}`);
        if (conv) {
          await closeConversation(conv).catch(() => {});
        }
      }
    })();

    res.json({ sessionId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Status Endpoint
app.get("/api/review/status/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    id: session.id,
    status: session.status,
    statusMessage: session.statusMessage,
    screenshot: session.screenshot,
    error: session.error,
    feedback: session.feedback,
    logs: session.logs,
    messages: session.messages,
    persona: session.persona,
    url: session.url,
    costTracker: session.conv ? {
      total: session.conv.costTracker.total(),
      remaining: session.conv.costTracker.remaining(),
      limit: session.conv.costCapUsd,
    } : null,
  });
});

// Follow-up Chat Endpoint
app.post("/api/review/chat/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (!session.conv) {
    return res.status(400).json({ error: "Session browser is not open" });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  session.status = "running";
  session.statusMessage = `Thinking about follow-up: "${message}"...`;
  session.logs.push(`User asked: "${message}"`);
  session.messages.push({
    role: "user",
    text: message,
  });

  // Run in background
  (async () => {
    try {
      const result = await runFollowUpTurn(session.conv!, message);
      session.status = "completed";
      session.statusMessage = "Answer received.";
      session.screenshot = getLatestScreenshot(session.conv!);
      session.messages.push({
        role: "persona",
        text: result.answer,
        screenshot: session.screenshot || undefined,
        costUsd: result.costUsd,
      });
      session.logs.push(`Answer received: "${result.answer.substring(0, 60)}..."`);
    } catch (err) {
      console.error("Chat turn failed:", err);
      session.status = "completed"; // revert back so user can retry
      session.statusMessage = `Failed to get response: ${(err as Error).message}`;
      session.logs.push(`Chat error: ${(err as Error).message}`);
    }
  })();

  res.json({ ok: true });
});

// Close Session Endpoint (Cleanup)
app.post("/api/review/close/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.conv) {
    await closeConversation(session.conv).catch(() => {});
  }
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Persona Review Web UI running at:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`==================================================`);
});
