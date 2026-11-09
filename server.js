
require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

app.use(express.json({ limit: "1mb" }));

// Serve frontend files
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/style.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

// API rate limiting
app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Buddy AI",
    model: MODEL,
    databaseConfigured: Boolean(
      SUPABASE_URL && SUPABASE_SECRET_KEY
    )
  });
});

// Save conversation to Supabase
async function saveToSupabase(content) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.warn("Supabase environment variables are missing.");
    return;
  }

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/memories`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        id: randomUUID(),
        content: content
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase save failed: ${error}`);
  }
}

// Gemini chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "The server is missing GEMINI_API_KEY."
      });
    }

    const message =
      typeof req.body.message === "string"
        ? req.body.message.trim()
        : "";

    const history = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    const savedMemories = await getMemories();const contents = [];

    for (const item of history.slice(-12)) {
      if (!item || typeof item.text !== "string") continue;

      const role = item.role === "model" ? "model" : "user";

      contents.push({
        role,
        parts: [{ text: item.text.slice(0, 4000) }]
      });
    }

    contents.push({
      role: "user",
      parts: [{ text: message.slice(0, 4000) }]
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are Buddy, an intelligent, friendly personal AI assistant. Be natural, warm, accurate, and helpful. Understand the user's question before answering. Avoid robotic or repetitive language. Remember the conversation context provided. Explain complicated topics simply and adapt answer length to the question. Ask for clarification when needed. Be friendly without pretending to be human. Support English, Bangla, and Arabic. Reply in the language the user uses unless they ask otherwise."
            }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const detail =
        data?.error?.message || "Gemini request failed.";

      return res.status(response.status).json({
        error: detail
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    // Save both messages to Supabase
    try {
      await saveToSupabase(`User: ${message}`);
      await saveToSupabase(`Buddy: ${reply}`);
    } catch (dbError) {
      console.error("Database error:", dbError.message);
    }

    res.json({ reply });

  } catch (error) {
    console.error("Buddy chat error:", error);

    res.status(500).json({
      error: "Something went wrong on the Buddy server. Please try again."
    });
  }
});

// Unknown routes
app.use((_req, res) => {
  res.status(404).json({
    error: "Page not found."
  });
});

app.listen(PORT, () => {
  console.log(`Buddy AI server running on port ${PORT}`);
});
