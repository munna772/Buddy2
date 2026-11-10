
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const chat = document.getElementById("chat");

if (!form || !input || !send || !chat) {
  throw new Error("Buddy chat interface elements are missing.");
}

const history = [];

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 12;
const TOKEN_STORAGE_KEY = "buddy_access_token";

let activeController = null;

// =====================================
// STOP GENERATION BUTTON
// =====================================

const stopButton = document.createElement("button");

stopButton.type = "button";
stopButton.className = send.className;
stopButton.textContent = "Stop";
stopButton.hidden = true;

send.insertAdjacentElement("afterend", stopButton);

stopButton.addEventListener("click", () => {
  if (activeController) {
    activeController.abort();
  }
});

// =====================================
// CREATE CHAT BUBBLES SAFELY
// =====================================

function addBubble(text, who) {
  const bubble = document.createElement("div");

  bubble.className = `bubble ${who}`;
  bubble.textContent = text;

  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;

  return bubble;
}

// =====================================
// GET ACCESS TOKEN
// =====================================

function getAccessToken() {
  let token = localStorage.getItem(TOKEN_STORAGE_KEY);

  if (!token) {
    token = window.prompt("Enter your Buddy access token:");

    if (!token || !token.trim()) {
      throw new Error("Buddy access token is required.");
    }

    token = token.trim();
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  return token;
}

// =====================================
// VIEW SAVED PERSONAL MEMORIES
// =====================================

const memoriesButton = document.getElementById("view-memories");
const memoriesPanel = document.getElementById("memories-panel");
const memoriesList = document.getElementById("memories-list");
const memoriesStatus = document.getElementById("memories-status");

function formatMemoryDate(value) {
  if (!value) return "Date unavailable";

  // Supabase may return a timestamp without a timezone when the column
  // is timestamp without time zone. Buddy stores these values as UTC,
  // so explicitly interpret timezone-less values as UTC before display.
  const timestamp = String(value).trim().replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp);
  const date = new Date(hasTimezone ? timestamp : `${timestamp}Z`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka"
  }).format(date);
}

function renderMemories(memories) {
  memoriesList.replaceChildren();

  if (!memories.length) {
    memoriesStatus.textContent = "No saved personal memories yet.";
    return;
  }

  memoriesStatus.textContent = `${memories.length} saved personal memor${memories.length === 1 ? "y" : "ies"}`;

  for (const memory of memories) {
    const item = document.createElement("article");
    item.className = "memory-item";

    const content = document.createElement("p");
    content.className = "memory-content";
    content.textContent = memory.content;

    const date = document.createElement("time");
    date.className = "memory-date";
    date.textContent = formatMemoryDate(memory.created_at);
    if (memory.created_at) date.dateTime = memory.created_at;

    item.append(content, date);
    memoriesList.appendChild(item);
  }
}

async function loadMemories() {
  memoriesButton.disabled = true;
  memoriesStatus.textContent = "Loading saved memories...";
  memoriesList.replaceChildren();

  try {
    const token = getAccessToken();
    const response = await fetch("/api/memories", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw new Error("Your access token is invalid. Please reopen Buddy and enter it again.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Could not load memories (${response.status}).`);
    }

    renderMemories(Array.isArray(data.memories) ? data.memories : []);
  } catch (error) {
    memoriesStatus.textContent = error.message || "Could not load saved memories.";
  } finally {
    memoriesButton.disabled = false;
  }
}

memoriesButton.addEventListener("click", async () => {
  const opening = memoriesPanel.hidden;
  memoriesPanel.hidden = !opening;
  memoriesButton.setAttribute("aria-expanded", String(opening));

  if (opening) await loadMemories();
});

// =====================================
// READ STREAMING RESPONSE
// =====================================

async function readStream(response, bubble) {
  if (!response.body) {
    throw new Error(
      "Streaming is not supported by this connection."
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let dataLines = [];
  let reply = "";
  let completed = false;

  function dispatchEvent() {
    if (!dataLines.length) return;

    const data = dataLines.join("\n");
    dataLines = [];

    if (data.trim() === "[DONE]") {
      completed = true;
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error(
        "Buddy sent an invalid streaming response."
      );
    }

    if (parsed.error) {
      throw new Error(
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error.message || "Buddy encountered an error."
      );
    }

    if (
      typeof parsed.text === "string" &&
      parsed.text.length > 0
    ) {
      reply += parsed.text;

      bubble.textContent = reply;
      chat.scrollTop = chat.scrollHeight;
    }
  }

  function processLine(line) {
    if (line === "") {
      dispatchEvent();
      return;
    }

    if (line.startsWith(":")) {
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(
        line.slice(5).replace(/^ /, "")
      );
    }
  }

  function consumeLines(final = false) {
    while (true) {
      const cr = buffer.indexOf("\r");
      const lf = buffer.indexOf("\n");

      let index;

      if (cr === -1) {
        index = lf;
      } else if (lf === -1) {
        index = cr;
      } else {
        index = Math.min(cr, lf);
      }

      if (index === -1) break;

      // Wait if a CR might be followed by LF
      // in the next network chunk.
      if (
        buffer[index] === "\r" &&
        index === buffer.length - 1 &&
        !final
      ) {
        break;
      }

      const line = buffer.slice(0, index);

      const separatorLength =
        buffer[index] === "\r" &&
        buffer[index + 1] === "\n"
          ? 2
          : 1;

      buffer = buffer.slice(
        index + separatorLength
      );

      processLine(line);
    }

    if (final && buffer.length > 0) {
      processLine(buffer);
      buffer = "";
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      consumeLines();
    }

    buffer += decoder.decode();

    consumeLines(true);

    // A final blank line dispatches the last SSE event.
    if (dataLines.length) {
      dispatchEvent();
    }

    if (!completed) {
      throw new Error(
        "Buddy's response was interrupted."
      );
    }

    if (!reply.trim()) {
      throw new Error(
        "Buddy returned an empty response."
      );
    }

    return reply;

  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Stream may already be closed.
    }

    throw error;

  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released.
    }
  }
}

// =====================================
// SEND MESSAGE
// =====================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Prevent another request while Buddy is responding.
  if (activeController) return;

  const message = input.value.trim();

  if (!message) return;

  if (message.length > MAX_MESSAGE_LENGTH) {
    addBubble(
      "Your message is too long. Please shorten it.",
      "buddy"
    );
    return;
  }

  const userBubble = addBubble(message, "user");

  input.value = "";

  send.disabled = true;
  send.textContent = "...";

  stopButton.hidden = false;
  stopButton.disabled = false;

  const waiting = addBubble(
    "Buddy is thinking...",
    "buddy"
  );

  const controller = new AbortController();
  activeController = controller;

  try {
    const token = getAccessToken();

    const response = await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },

      body: JSON.stringify({
        message,
        history: history.slice(-MAX_HISTORY)
      }),

      signal: controller.signal
    });

    // Authentication error
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);

      throw new Error(
        "Invalid access token. Please enter the correct token."
      );
    }

    // Quota error
    if (response.status === 429) {
      const data = await response.json().catch(() => ({}));

      throw new Error(
        data.error ||
        "Buddy has reached its usage limit. Please try again later."
      );
    }

    // Other server errors
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));

      throw new Error(
        data.error ||
        `Server error (${response.status}).`
      );
    }

    // Verify streaming response
    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/event-stream")) {
      throw new Error(
        "Buddy returned an unexpected response format."
      );
    }

    // Receive response progressively
    const reply = await readStream(response, waiting);

    // Save completed conversation
    history.push(
      { role: "user", text: message },
      { role: "model", text: reply }
    );

    // Keep recent history
    if (history.length > MAX_HISTORY) {
      history.splice(
        0,
        history.length - MAX_HISTORY
      );
    }

  } catch (error) {
    // Handle intentional stopping
    if (controller.signal.aborted) {
      const partial = waiting.textContent;

      waiting.textContent =
        partial === "Buddy is thinking..."
          ? "Generation stopped."
          : `${partial}\n\nGeneration stopped.`;

      return;
    }

    // Restore failed message for retry
    input.value = message;

    // Avoid duplicate user messages
    userBubble.remove();

    const partial = waiting.textContent;

    waiting.textContent =
      partial === "Buddy is thinking..."
        ? `Sorry, I couldn't reply: ${error.message}`
        : `${partial}\n\nResponse interrupted: ${error.message}`;

    console.error("Buddy error:", error);

  } finally {
    activeController = null;

    send.disabled = false;
    send.textContent = "Send";

    stopButton.hidden = true;
    stopButton.disabled = false;

    input.focus();
  }
});
