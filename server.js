const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MESSAGES_FILE = path.join(__dirname, "messages.json");

// Initialize messages file
async function initMessagesFile() {
  try {
    await fs.access(MESSAGES_FILE);
  } catch {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify([]));
  }
}

// Load messages
async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading messages:", err);
    return [];
  }
}

// Save messages
async function saveMessages(messages) {
  try {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("Error saving messages:", err);
  }
}

initMessagesFile();

wss.on("connection", async (ws) => {
  console.log("New client connected");

  // Send existing messages
  const messages = await loadMessages();
  messages.forEach((msg) => ws.send(JSON.stringify(msg)));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "chat" && msg.user && msg.rank && msg.text) {
        const chatMessage = {
          user: msg.user,
          rank: msg.rank,
          text: msg.text,
          timestamp: new Date().toISOString(),
        };
        console.log(`Received: ${msg.rank} ${msg.user}: ${msg.text}`);
        messages.push(chatMessage);
        await saveMessages(messages);
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(chatMessage));
          }
        });
      }
    } catch (err) {
      console.error("Invalid message format:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

app.get("/", (req, res) => {
  res.send("WebSocket server running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});