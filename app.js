import { listenForSpeech, speakText, stopSpeaking, unlockSpeechAudio } from './voice.js';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

const BuddyWakeWord = registerPlugin('BuddyWakeWord');


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
let voiceRepliesEnabled = false;
let speakNextReply = false;

const voiceInputButton = document.getElementById("voice-input");
const voiceRepliesButton = document.getElementById("voice-replies");
const stopSpeakingButton = document.getElementById("stop-speaking");
const voiceLanguageSelect = document.getElementById("voice-language");
const voiceStatus = document.getElementById("voice-status");
const wakeWordButton = document.getElementById("wake-word-toggle");
const wakeWordStatus = document.getElementById("wake-word-status");
const voiceDock = document.querySelector(".voice-dock");
const WAKE_WORD_STORAGE_KEY = "buddy_wake_word_enabled";

function nativeWakeWordAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BuddyWakeWord");
}

async function pauseWakeWord() {
  if (!nativeWakeWordAvailable()) return;
  try { await BuddyWakeWord.pause(); } catch (error) {
    console.warn("Could not pause Hey Buddy listener:", error);
  }
}

async function resumeWakeWordIfEnabled() {
  if (!nativeWakeWordAvailable() || localStorage.getItem(WAKE_WORD_STORAGE_KEY) !== "true") return;
  try {
    await BuddyWakeWord.start();
    if (wakeWordStatus) wakeWordStatus.textContent = "Listening for “Hey Buddy” in the background.";
    if (wakeWordButton) wakeWordButton.textContent = "Disable Hey Buddy";
  } catch (error) {
    if (wakeWordStatus) wakeWordStatus.textContent = error.message || "Could not restart Hey Buddy listening.";
  }
}

async function handlePendingWake() {
  if (!nativeWakeWordAvailable()) return false;
  try {
    const result = await BuddyWakeWord.consumeWake();
    if (!result.wakeDetected) return false;
    if (voiceDock) voiceDock.open = true;
    voiceRepliesEnabled = true;
    if (voiceRepliesButton) {
      voiceRepliesButton.setAttribute("aria-pressed", "true");
      voiceRepliesButton.textContent = "🔊 Coral voice: On";
    }
    speakNextReply = true;
    if (voiceStatus) voiceStatus.textContent = "I heard you. Speak now.";
    voiceInputButton?.click();
    return true;
  } catch (error) {
    if (wakeWordStatus) wakeWordStatus.textContent = error.message || "Could not resume after the wake phrase.";
    return false;
  }
}

async function syncWakeWordStatus() {
  if (!wakeWordButton || !wakeWordStatus) return;
  if (!nativeWakeWordAvailable()) {
    wakeWordButton.disabled = true;
    wakeWordButton.textContent = "Hey Buddy (Android app only)";
    wakeWordStatus.textContent = "Background wake listening requires the updated Buddy APK.";
    return;
  }
  wakeWordButton.disabled = false;
  try {
    const status = await BuddyWakeWord.status();
    if (status.error) {
      wakeWordStatus.textContent = status.error;
    } else if (status.enabled && status.listening) {
      wakeWordStatus.textContent = "Listening for “Hey Buddy” in the background.";
    } else if (status.enabled) {
      wakeWordStatus.textContent = "Hey Buddy is enabled and will resume listening.";
    } else {
      wakeWordStatus.textContent = "Background wake listening is off.";
    }
    wakeWordButton.textContent = status.enabled ? "Disable Hey Buddy" : "Enable Hey Buddy";
    localStorage.setItem(WAKE_WORD_STORAGE_KEY, String(Boolean(status.enabled)));
  } catch (error) {
    wakeWordStatus.textContent = error.message || "Could not check wake-word status.";
  }
}

if (wakeWordButton) {
  wakeWordButton.addEventListener("click", async () => {
    if (!nativeWakeWordAvailable()) {
      if (wakeWordStatus) wakeWordStatus.textContent = "Install the updated Buddy Android APK to use Hey Buddy.";
      return;
    }
    wakeWordButton.disabled = true;
    try {
      if (localStorage.getItem(WAKE_WORD_STORAGE_KEY) === "true") {
        await BuddyWakeWord.stop();
        localStorage.setItem(WAKE_WORD_STORAGE_KEY, "false");
        wakeWordButton.textContent = "Enable Hey Buddy";
        if (wakeWordStatus) wakeWordStatus.textContent = "Background wake listening is off.";
      } else {
        await BuddyWakeWord.start();
        localStorage.setItem(WAKE_WORD_STORAGE_KEY, "true");
        wakeWordButton.textContent = "Disable Hey Buddy";
        if (wakeWordStatus) wakeWordStatus.textContent = "Listening for “Hey Buddy”. Keep the notification visible.";
      }
    } catch (error) {
      if (wakeWordStatus) wakeWordStatus.textContent = error.message || "Could not change wake-word setting.";
    } finally {
      wakeWordButton.disabled = false;
    }
  });
}

function selectedVoiceLanguage() {
  return voiceLanguageSelect?.value || "en-US";
}

// Avoid showing Coral as available when the server has no OpenAI key configured.
async function checkCoralVoiceAvailability() {
  if (!voiceRepliesButton) return;
  voiceRepliesButton.disabled = true;
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await response.json().catch(() => ({}));
    const configured = response.ok && health.openaiVoiceConfigured === true;
    voiceRepliesButton.disabled = !configured;
    if (voiceStatus) {
      voiceStatus.textContent = configured
        ? "Coral voice is ready."
        : "Coral voice is unavailable. Add OPENAI_API_KEY in Render.";
    }
  } catch {
    // Keep the feature available if the health check itself is temporarily unreachable.
    voiceRepliesButton.disabled = false;
  }
}
void checkCoralVoiceAvailability();

if (voiceRepliesButton) {
  voiceRepliesButton.addEventListener("click", () => {
    if (!voiceRepliesEnabled) void unlockSpeechAudio().catch(error => console.warn("Audio unlock failed:", error));
    voiceRepliesEnabled = !voiceRepliesEnabled;
    voiceRepliesButton.setAttribute("aria-pressed", String(voiceRepliesEnabled));
    voiceRepliesButton.textContent = voiceRepliesEnabled
      ? "🔊 Coral voice: On"
      : "🔊 Coral voice: Off";
    if (!voiceRepliesEnabled) stopSpeaking();
    if (voiceStatus) voiceStatus.textContent = voiceRepliesEnabled
      ? "Buddy will speak using OpenAI Coral."
      : "Spoken replies are off.";
  });
}

if (stopSpeakingButton) {
  stopSpeakingButton.addEventListener("click", () => {
    stopSpeaking();
    if (voiceStatus) voiceStatus.textContent = "Buddy stopped speaking.";
  });
}

if (voiceInputButton) {
  voiceInputButton.addEventListener("click", async () => {
    void unlockSpeechAudio().catch(error => console.warn("Audio unlock failed:", error));
    if (activeController) return;
    voiceInputButton.disabled = true;
    await pauseWakeWord();
    voiceInputButton.textContent = "Listening...";
    if (voiceStatus) voiceStatus.textContent = "Speak now. Buddy is listening.";
    try {
      const transcript = await listenForSpeech(selectedVoiceLanguage());
      input.value = transcript;
      speakNextReply = true;
      if (voiceStatus) voiceStatus.textContent = "You said: " + transcript;
      form.requestSubmit();
    } catch (error) {
      speakNextReply = false;
      if (voiceStatus) voiceStatus.textContent = error.message || "Voice input failed.";
      await resumeWakeWordIfEnabled();
    } finally {
      voiceInputButton.disabled = false;
      voiceInputButton.textContent = "🎙️ Talk";
    }
  });
}

// =====================================
// STOP GENERATION BUTTON
// =====================================

const stopButton = document.createElement("button");

stopButton.type = "button";
stopButton.className = send.className;
stopButton.textContent = "Stop";
stopButton.hidden = true;
stopButton.setAttribute("aria-label", "Stop generating response");
stopButton.title = "Stop generating response";

send.insertAdjacentElement("afterend", stopButton);

stopButton.addEventListener("click", () => {
  stopSpeaking();
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
  if (typeof content !== "string" || !content.startsWith("User: ")) {
    return null;
  }

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

// Keep the foreground service state in sync and resume after Android returns to Buddy.
if (Capacitor.isNativePlatform()) {
  (async () => {
    const woke = await handlePendingWake();
    await syncWakeWordStatus();
    if (!woke && localStorage.getItem(WAKE_WORD_STORAGE_KEY) === "true") {
      await resumeWakeWordIfEnabled();
    }
  })();
  App.addListener("appStateChange", async ({ isActive }) => {
    if (!isActive) return;
    const woke = await handlePendingWake();
    await syncWakeWordStatus();
    if (!woke && localStorage.getItem(WAKE_WORD_STORAGE_KEY) === "true") {
      await resumeWakeWordIfEnabled();
    }
  });
  // Also catch the wake event when Buddy is already visible and Android
  // does not emit a background-to-foreground lifecycle transition.
  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void handlePendingWake();
    }
  }, 900);
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
    await pauseWakeWord();
    const token = getAccessToken();

    const response = await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },

      body: JSON.stringify({
        message,
        history: history.slice(-MAX_HISTORY),
        voiceMode: voiceRepliesEnabled || speakNextReply
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

    if (voiceRepliesEnabled || speakNextReply) {
      try {
        await speakText(reply, selectedVoiceLanguage());
        if (voiceStatus) voiceStatus.textContent = "Buddy finished speaking.";
      } catch (error) {
        if (voiceStatus) voiceStatus.textContent = error.message || "Spoken replies are unavailable.";
      }
    }
    speakNextReply = false;

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

    waiting.textContent =
      partial === "Buddy is thinking..."
        ? `Sorry, I couldn't reply: ${friendlyError}`
        : `${partial}\n\nResponse interrupted: ${friendlyError}`;

    console.error("Buddy error:", error);

  } finally {
    activeController = null;
    speakNextReply = false;

    send.disabled = false;
    send.textContent = "Send";

    stopButton.hidden = true;
    stopButton.disabled = false;
    stopButton.textContent = "Stop";

    input.focus();
    await resumeWakeWordIfEnabled();
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
