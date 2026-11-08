const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const chat = document.getElementById("chat");
const history = [];

function addBubble(text, who) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${who}`;
  bubble.textContent = text;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addBubble(message, "user");
  input.value = "";
  input.focus();
  send.disabled = true;
  send.textContent = "...";
  const waiting = addBubble("Buddy is thinking...", "buddy");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history })
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Request failed.");
    waiting.remove();
    addBubble(data.reply, "buddy");
    history.push({ role: "user", text: message });
    history.push({ role: "model", text: data.reply });
  } catch (error) {
    waiting.textContent = `Sorry, I couldn't reply: ${error.message}`;
  } finally {
    send.disabled = false;
    send.textContent = "Send";
  }
});
