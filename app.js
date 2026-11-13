
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const chat = document.getElementById("chat");
const accessDialog = document.getElementById("access-dialog");
const accessForm = document.getElementById("access-form");
const accessInput = document.getElementById("access-token");
const accessError = document.getElementById("access-error");
const accessButton = document.getElementById("manage-access");
const accessCancel = document.getElementById("access-cancel");
const connectionPill = document.getElementById("connection-pill");
const connectionStatus = document.getElementById("connection-status");
const messageCount = document.getElementById("message-count");
const sendLabel = send?.querySelector("span") || send;

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
stopButton.id = "buddy-stop";
stopButton.className = send.className;
stopButton.textContent = "Stop";
stopButton.hidden = true;
stopButton.setAttribute("aria-label", "Stop generating response");
stopButton.title = "Stop generating response";

send.insertAdjacentElement("afterend", stopButton);

stopButton.addEventListener("click", () => {
  if (activeController && !activeController.signal.aborted) {
    stopButton.disabled = true;
    stopButton.textContent = "Stopping...";
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
// SECURE ACCESS DIALOG
// =====================================

function openAccessDialog() {
  if (!accessDialog || !accessInput || !accessError) {
    throw new Error("Buddy's access form is unavailable. Refresh the app and try again.");
  }

  accessError.textContent = "";
  accessInput.value = "";

  if (typeof accessDialog.showModal === "function") {
    if (!accessDialog.open) accessDialog.showModal();
    window.setTimeout(() => accessInput.focus(), 50);
    return;
  }

  // Compatibility fallback for older Android WebViews without <dialog>.
  const entered = window.prompt("Enter your Buddy access token:");
  if (entered && new TextEncoder().encode(entered.trim()).length >= 32) {
    localStorage.setItem(TOKEN_STORAGE_KEY, entered.trim());
    if (historyButton) loadConversationHistory(true);
  } else if (entered !== null) {
    window.alert("The Buddy access token must contain at least 32 bytes.");
  }
}

function getAccessToken() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);

  if (!token) {
    openAccessDialog();
    throw new Error("Connect your Buddy access token, then send the message again.");
  }

  return token;
}

if (accessButton) {
  accessButton.addEventListener("click", openAccessDialog);
}

if (accessCancel && accessDialog) {
  accessCancel.addEventListener("click", () => accessDialog.close());
}

if (accessForm && accessDialog && accessInput && accessError) {
  accessForm.addEventListener("submit", event => {
    event.preventDefault();
    const token = accessInput.value.trim();
    const tokenBytes = new TextEncoder().encode(token).length;

    if (tokenBytes < 32) {
      accessError.textContent = "Your access token must contain at least 32 bytes.";
      accessInput.focus();
      return;
    }

    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    accessDialog.close();
    accessInput.value = "";
    accessError.textContent = "";

    if (historyStatus) {
      historyStatus.textContent = "Secure access token saved on this device.";
    }
    if (historyButton) loadConversationHistory(true);
  });
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

    const actions = document.createElement("div");
    actions.className = "memory-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "memory-edit";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => editMemory(memory));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "memory-delete";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteMemory(memory));

    actions.append(editButton, deleteButton);
    item.append(content, date, actions);
    memoriesList.appendChild(item);
  }
}

async function memoryRequest(url, options = {}) {
  const token = getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    throw new Error("Your access token is invalid. Please reopen Buddy and enter it again.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Memory action failed (${response.status}).`);
  }
  return data;
}

async function editMemory(memory) {
  const updatedContent = window.prompt("Correct this saved memory:", memory.content);
  if (updatedContent === null) return;
  if (!updatedContent.trim()) {
    window.alert("Memory cannot be empty.");
    return;
  }
  if (updatedContent.trim() === memory.content) return;

  memoriesStatus.textContent = "Updating memory...";
  try {
    await memoryRequest(`/api/memories/${encodeURIComponent(memory.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: updatedContent.trim() })
    });
    await loadMemories();
    memoriesStatus.textContent = "Memory updated successfully.";
  } catch (error) {
    memoriesStatus.textContent = error.message || "Could not update memory.";
  }
}

async function deleteMemory(memory) {
  if (!window.confirm("Delete only this saved personal memory? This cannot be undone.")) return;

  memoriesStatus.textContent = "Deleting memory...";
  try {
    await memoryRequest(`/api/memories/${encodeURIComponent(memory.id)}`, {
      method: "DELETE"
    });
    await loadMemories();
    memoriesStatus.textContent = "Memory deleted.";
  } catch (error) {
    memoriesStatus.textContent = error.message || "Could not delete memory.";
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
// RESTORE SAVED CONVERSATION HISTORY
// =====================================

const historyButton = document.getElementById("load-history");
const historyStatus = document.getElementById("history-status");

function parseSavedConversation(content) {
  if (typeof content !== "string") return null;

  // Versioned JSON preserves messages even when either side contains the
  // legacy "User:" / "Buddy:" separator text.
  if (content.startsWith("CHAT_V1:")) {
    try {
      const record = JSON.parse(content.slice("CHAT_V1:".length));
      if (
        typeof record.user === "string" &&
        typeof record.assistant === "string" &&
        record.user.trim() &&
        record.assistant.trim()
      ) {
        return { userText: record.user, buddyText: record.assistant };
      }
    } catch {
      return null;
    }
  }

  // Read older conversation rows saved before CHAT_V1 was introduced.
  if (!content.startsWith("User: ")) return null;
  const separator = "\n\nBuddy: ";
  const separatorIndex = content.indexOf(separator);
  if (separatorIndex < 0) return null;

  const userText = content.slice(6, separatorIndex).trim();
  const buddyText = content.slice(separatorIndex + separator.length).trim();
  if (!userText || !buddyText) return null;

  return { userText, buddyText };
}

async function loadConversationHistory(silent = false) {
  if (!historyButton || !historyStatus) return;

  historyButton.disabled = true;
  if (!silent) historyStatus.textContent = "Loading previous conversations...";

  try {
    const token = getAccessToken();
    const response = await fetch("/api/history", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw new Error("Your access token is invalid. Please enter it again.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Could not load history (${response.status}).`);
    }

    const conversations = Array.isArray(data.conversations)
      ? data.conversations.slice().reverse()
      : [];

    const restored = conversations
      .map(item => parseSavedConversation(item.content))
      .filter(Boolean);

    chat.replaceChildren();
    history.length = 0;

    if (!restored.length) {
      addBubble("Hey! I'm Buddy. What would you like to talk about?", "buddy");
      historyStatus.textContent = "No saved conversations found yet.";
      return;
    }

    for (const conversation of restored) {
      addBubble(conversation.userText, "user");
      addBubble(conversation.buddyText, "buddy");
      history.push(
        { role: "user", text: conversation.userText },
        { role: "model", text: conversation.buddyText }
      );
    }

    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    historyStatus.textContent = `Restored ${restored.length} previous conversation${restored.length === 1 ? "" : "s"}.`;
    chat.scrollTop = chat.scrollHeight;
  } catch (error) {
    if (!silent) {
      historyStatus.textContent = error.message || "Could not load previous conversations.";
    }
  } finally {
    historyButton.disabled = false;
  }
}

if (historyButton) {
  historyButton.addEventListener("click", () => loadConversationHistory(false));
}

// Restore automatically when this browser already has Buddy's access token.
if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
  loadConversationHistory(true);
}

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
// FRIENDLY CHAT ERROR MESSAGES
// =====================================

function getFriendlyChatError(error) {
  const message = String(error?.message || "");

  if (/failed to fetch|networkerror|load failed|internet/i.test(message)) {
    return "Couldn't connect to Buddy. Check your internet connection and try again.";
  }

  if (/timed out|timeout|took too long/i.test(message)) {
    return "Buddy took too long to respond. Please try again.";
  }

  return message || "Buddy couldn't complete your request. Please try again.";
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

  document.getElementById("welcome")?.remove();
  const userBubble = addBubble(message, "user");

  input.value = "";
  if (messageCount) messageCount.textContent = "0 / 4000";

  send.disabled = true;
  sendLabel.textContent = "Sending";

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
    setConnectionState("online", "Service online");

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
    const friendlyError = getFriendlyChatError(error);
    if (/failed to fetch|networkerror|load failed|internet/i.test(String(error?.message || ""))) {
      setConnectionState("offline", "Connection issue");
    }

    waiting.textContent =
      partial === "Buddy is thinking..."
        ? `Sorry, I couldn't reply: ${friendlyError}`
        : `${partial}\n\nResponse interrupted: ${friendlyError}`;

    console.error("Buddy error:", error);

  } finally {
    activeController = null;

    send.disabled = false;
    sendLabel.textContent = "Send";

    stopButton.hidden = true;
    stopButton.disabled = false;
    stopButton.textContent = "Stop";

    input.focus();
  }
});


// =====================================
// INSTALLABLE ANDROID / PWA SUPPORT
// =====================================

if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Buddy offline app shell could not be registered:', error);
    });
  });
}

// =====================================
// CONNECTION STATUS AND COMPOSER HELPERS
// =====================================

function setConnectionState(state, label) {
  if (!connectionPill || !connectionStatus) return;
  connectionPill.dataset.state = state;
  connectionStatus.textContent = label;
}

async function checkBuddyConnection() {
  if (!connectionPill || !connectionStatus) return;

  if (navigator.onLine === false) {
    setConnectionState("offline", "No internet");
    return;
  }

  try {
    const response = await fetch("/api/health", {
      method: "GET",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok !== true) {
      throw new Error("Buddy service is not ready.");
    }

    setConnectionState("online", "Service online");
  } catch {
    setConnectionState("offline", "Service unavailable");
  }
}

if (messageCount) {
  const updateMessageCount = () => {
    messageCount.textContent = `${input.value.length.toLocaleString()} / 4000`;
  };
  input.addEventListener("input", updateMessageCount);
  updateMessageCount();
}

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    const prompt = button.getAttribute("data-prompt");
    if (!prompt) return;
    input.value = prompt;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

window.addEventListener("online", checkBuddyConnection);
window.addEventListener("offline", () => setConnectionState("offline", "No internet"));
checkBuddyConnection();
