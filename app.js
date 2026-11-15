
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
let historyLoading = false;

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
    if (historyButton) loadConversationList(true);
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
    if (historyButton) loadConversationList(true);
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
// =====================================
// CONVERSATION LIST AND THREAD RESTORATION
// =====================================

const historyButton = document.getElementById("load-history");
const historyStatus = document.getElementById("history-status");
const conversationList = document.getElementById("conversation-list");
const newChatButton = document.getElementById("new-chat");
const chatLayout = document.getElementById("chat-layout");
const toggleChatsButton = document.getElementById("toggle-chats");
const ACTIVE_CONVERSATION_KEY = "buddy_active_conversation";
let activeConversationId = localStorage.getItem(ACTIVE_CONVERSATION_KEY) || null;
let savedConversations = [];

const welcomeTemplate = document.getElementById("welcome")?.cloneNode(true);

function createConversationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function attachPromptButtons(root = document) {
  root.querySelectorAll("[data-prompt]").forEach(button => {
    if (button.dataset.promptBound === "true") return;
    button.dataset.promptBound = "true";
    button.addEventListener("click", () => {
      const prompt = button.getAttribute("data-prompt");
      if (!prompt) return;
      input.value = prompt;
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

function showNewChatWelcome() {
  chat.replaceChildren();
  if (welcomeTemplate) {
    const welcome = welcomeTemplate.cloneNode(true);
    chat.appendChild(welcome);
    attachPromptButtons(welcome);
  } else {
    addBubble("Hey! I'm Buddy. What would you like to talk about?", "buddy");
  }
}

function renderConversationList() {
  if (!conversationList) return;
  conversationList.replaceChildren();

  if (!savedConversations.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent = "Your new conversations will appear here.";
    conversationList.appendChild(empty);
    return;
  }

  for (const conversation of savedConversations) {
    const item = document.createElement("div");
    item.className = "conversation-list-item";
    item.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("active", conversation.id === activeConversationId);
    button.setAttribute("aria-current", conversation.id === activeConversationId ? "page" : "false");

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title || "New chat";

    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    const lastMessage = conversation.messages?.[conversation.messages.length - 1];
    preview.textContent = lastMessage?.userText || "No messages";

    button.append(title, preview);
    button.addEventListener("click", () => openConversation(conversation.id));
    item.appendChild(button);
    conversationList.appendChild(item);
  }
}

function openConversation(conversationId) {
  if (activeController) {
    if (historyStatus) historyStatus.textContent = "Finish Buddy's reply before switching chats.";
    return;
  }

  const conversation = savedConversations.find(item => item.id === conversationId);
  if (!conversation) return;

  activeConversationId = conversation.id;
  localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
  history.length = 0;
  chat.replaceChildren();

  for (const message of conversation.messages || []) {
    addBubble(message.userText, "user");
    addBubble(message.buddyText, "buddy");
    history.push(
      { role: "user", text: message.userText },
      { role: "model", text: message.buddyText }
    );
  }

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  if (!conversation.messages?.length) showNewChatWelcome();
  if (historyStatus) historyStatus.textContent = "";
  renderConversationList();
  chat.scrollTop = chat.scrollHeight;
  chatLayout?.classList.remove("sidebar-open");
  toggleChatsButton?.setAttribute("aria-expanded", "false");
  input.focus();
}

function startNewChat() {
  if (activeController || historyLoading) {
    if (historyStatus) historyStatus.textContent = "Wait for Buddy's reply to finish before starting a new chat.";
    return;
  }

  activeConversationId = createConversationId();
  localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
  history.length = 0;
  showNewChatWelcome();
  if (historyStatus) historyStatus.textContent = "New conversation started.";
  renderConversationList();
  chatLayout?.classList.remove("sidebar-open");
  toggleChatsButton?.setAttribute("aria-expanded", "false");
  input.focus();
}

async function loadConversationList(silent = false) {
  if (!historyButton || !historyStatus || historyLoading) return;
  if (activeController) {
    if (!silent) historyStatus.textContent = "Finish the current reply before refreshing chats.";
    return;
  }

  historyLoading = true;
  historyButton.disabled = true;
  if (!silent) historyStatus.textContent = "Refreshing your chats…";

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
      throw new Error(data.error || `Could not load chats (${response.status}).`);
    }

    savedConversations = Array.isArray(data.conversations) ? data.conversations : [];
    renderConversationList();

    const selected = activeConversationId
      ? savedConversations.find(item => item.id === activeConversationId)
      : savedConversations[0];

    if (selected) {
      openConversation(selected.id);
      if (!silent) historyStatus.textContent = `Loaded ${savedConversations.length} saved chat${savedConversations.length === 1 ? "" : "s"}.`;
    } else {
      history.length = 0;
      showNewChatWelcome();
      if (!silent) historyStatus.textContent = savedConversations.length
        ? "This is a new chat. Your other conversations are in the list."
        : "No saved chats yet. Start a new conversation.";
    }
  } catch (error) {
    if (!silent) historyStatus.textContent = error.message || "Could not load your chats.";
    if (!savedConversations.length) renderConversationList();
  } finally {
    historyLoading = false;
    historyButton.disabled = false;
  }
}

if (historyButton) {
  historyButton.addEventListener("click", () => loadConversationList(false));
}
if (newChatButton) newChatButton.addEventListener("click", startNewChat);
if (toggleChatsButton && chatLayout) {
  toggleChatsButton.addEventListener("click", () => {
    const opening = !chatLayout.classList.contains("sidebar-open");
    chatLayout.classList.toggle("sidebar-open", opening);
    toggleChatsButton.setAttribute("aria-expanded", String(opening));
  });
}

// Restore the last active thread when this device already has secure access.
if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
  loadConversationList(true);
} else {
  renderConversationList();
}
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
  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    const flush = () => {
      renderScheduled = false;
      bubble.textContent = reply;
      chat.scrollTop = chat.scrollHeight;
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 16);
    }
  }

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
      scheduleRender();
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

    // Flush any queued visual update before marking the stream complete.
    bubble.textContent = reply;
    chat.scrollTop = chat.scrollHeight;

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

  // Prevent requests that could race with restored history or another reply.
  if (activeController) return;
  if (historyLoading) {
    if (historyStatus) historyStatus.textContent = "Your previous conversations are still loading. Please send again in a moment.";
    input.focus();
    return;
  }

  const message = input.value.trim();

  if (!message) return;
  if (!activeConversationId || activeConversationId === "legacy-history") {
    // Legacy rows had no thread ID. Continue them in a new thread rather
    // than merging new messages into the read-only legacy archive group.
    activeConversationId = createConversationId();
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
  }

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
  send.hidden = true;
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
        conversationId: activeConversationId,
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
    checkBuddyConnection();

    // Save completed conversation
    history.push(
      { role: "user", text: message },
      { role: "model", text: reply }
    );

    // Update the sidebar immediately; the server persists this turn in the background.
    let currentConversation = savedConversations.find(item => item.id === activeConversationId);
    if (!currentConversation) {
      currentConversation = {
        id: activeConversationId,
        title: message.replace(/\\s+/g, " ").trim().slice(0, 64) || "New chat",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: []
      };
      savedConversations.unshift(currentConversation);
    }
    currentConversation.messages = currentConversation.messages || [];
    currentConversation.messages.push({ userText: message, buddyText: reply });
    currentConversation.updated_at = new Date().toISOString();
    savedConversations.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    renderConversationList();

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
    send.hidden = false;
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

    if (data.geminiConfigured !== true) {
      setConnectionState("degraded", "AI not configured");
    } else if (data.databaseConfigured !== true) {
      setConnectionState("degraded", "Chat online · Memory off");
    } else {
      setConnectionState("online", "Service online");
    }
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

attachPromptButtons(document);

window.addEventListener("online", checkBuddyConnection);
window.addEventListener("offline", () => setConnectionState("offline", "No internet"));
checkBuddyConnection();
