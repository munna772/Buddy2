const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const chat = document.getElementById("chat");

const history = [];

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 12;
const TOKEN_STORAGE_KEY = "buddy_access_token";

// Create chat bubbles safely
function addBubble(text, who) {
  const bubble = document.createElement("div");

  bubble.className = `bubble ${who}`;
  bubble.textContent = text;

  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;

  return bubble;
}

// Get private access token
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

// Read Gemini streaming response
async function readStream(response, bubble) {
  if (!response.body) {
    throw new Error("Streaming is not supported by this connection.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let reply = "";
  let completed = false;

  function processEvent(event) {
    const dataLines = [];

    for (const line of event.split(/\r\n|\n|\r/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }

    if (!dataLines.length) return;

    const data = dataLines.join("\n");

    if (data.trim() === "[DONE]") {
      completed = true;
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error("Buddy sent an invalid streaming response.");
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    if (typeof parsed.text === "string" && parsed.text.length) {
      reply += parsed.text;

      bubble.textContent = reply;
      chat.scrollTop = chat.scrollHeight;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);

      buffer = events.pop() || "";

      for (const event of events) {
        processEvent(event);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processEvent(buffer);
    }

    if (!completed) {
      throw new Error("Buddy's response was interrupted.");
    }

    if (!reply.trim()) {
      throw new Error("Buddy returned an empty response.");
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
    reader.releaseLock();
  }
}

// Send messages
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = input.value.trim();

  if (!message || send.disabled) return;

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

  const waiting = addBubble(
    "Buddy is thinking...",
    "buddy"
  );

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
      })
    });

    // Handle invalid authentication
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);

      throw new Error(
        "Invalid access token. Please enter the correct token."
      );
    }

    // Handle server errors
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));

      throw new Error(
        data.error || `Server error (${response.status}).`
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

    // Save only completed conversations
    history.push(
      { role: "user", text: message },
      { role: "model", text: reply }
    );

    // Keep recent conversation history
    if (history.length > MAX_HISTORY) {
      history.splice(
        0,
        history.length - MAX_HISTORY
      );
    }

  } catch (error) {
    // Restore failed message for retry
    input.value = message;

    // Avoid duplicate user messages on retry
    userBubble.remove();

    // Preserve any partial answer for reference
    waiting.textContent = waiting.textContent === "Buddy is thinking..."
      ? `Sorry, I couldn't reply: ${error.message}`
      : `${waiting.textContent}\n\nResponse interrupted: ${error.message}`;

    console.error("Buddy error:", error);

  } finally {
    send.disabled = false;
    send.textContent = "Send";
    input.focus();
  }
});
