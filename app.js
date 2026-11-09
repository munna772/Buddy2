const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const chat = document.getElementById("chat");

const history = [];

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 12;
const TOKEN_STORAGE_KEY = "buddy_access_token";

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
    token = window.prompt(
      "Enter your Buddy access token:"
    );

    if (!token || !token.trim()) {
      throw new Error("Buddy access token is required.");
    }

    token = token.trim();

    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  return token;
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

  addBubble(message, "user");

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

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);

      throw new Error(
        "Invalid access token. Please send your message again and enter the correct token."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error || `Server error (${response.status}).`
      );
    }

    if (
      typeof data.reply !== "string" ||
      !data.reply.trim()
    ) {
      throw new Error("Buddy returned an empty response.");
    }

    waiting.remove();

    addBubble(data.reply, "buddy");

    // Store successful conversation
    history.push(
      { role: "user", text: message },
      { role: "model", text: data.reply }
    );

    // Keep recent conversation history
    if (history.length > MAX_HISTORY) {
      history.splice(
        0,
        history.length - MAX_HISTORY
      );
    }

  } catch (error) {
    waiting.textContent =
      `Sorry, I couldn't reply: ${error.message}`;

    console.error("Buddy error:", error);

  } finally {
    send.disabled = false;
    send.textContent = "Send";
    input.focus();
  }
});
