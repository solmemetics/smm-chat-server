const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const { PublicKey } = require("@solana/web3.js");
const nacl = require("tweetnacl");

// Initialize Express and WebSocket server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Message storage file
const MESSAGES_FILE = "messages.json";

// Load or initialize messages
async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return []; // Initialize empty array if file doesn't exist
  }
}

async function saveMessages(messages) {
  await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

wss.on("connection", async (ws) => {
  console.log("New client connected");

  // Send all stored messages to new client
  const messages = await loadMessages();
  messages.forEach((msg) => ws.send(JSON.stringify(msg)));

  ws.on("message", async (data) => {
    try {
      const { user, rank, text, signature, publicKey } = JSON.parse(data);

      // Validate message
      if (!user || !rank || !text || !signature || !publicKey) {
        console.error("Invalid message format");
        return;
      }

      // Verify wallet signature
      let isValidSignature = false;
      try {
        const publicKeyObj = new PublicKey(publicKey);
        const messageBuffer = Buffer.from(text);
        const signatureBuffer = Buffer.from(signature, "base64");
        isValidSignature = nacl.sign.detached.verify(
          messageBuffer,
          signatureBuffer,
          publicKeyObj.toBuffer()
        );
      } catch (err) {
        console.error("Signature verification failed:", err);
        return;
      }

      if (!isValidSignature) {
        console.error("Invalid signature from", publicKey);
        return;
      }

      // Create message with timestamp
      const msg = {
        user,
        rank,
        text,
        publicKey,
        timestamp: new Date().toLocaleString("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
          timeZone: "Australia"
        }),
      };

      console.log(`Received: ${msg.rank} ${msg.user}: ${msg.text} at ${msg.timestamp}`);

      // Save message to file
      const messages = await loadMessages();
      messages.push(msg);
      await saveMessages(messages);

      // Broadcast to all clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(msg));
        }
      });
    } catch (err) {
      console.error("Message processing error:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

// Serve endpoint to keep Render awake
app.get("/", (req, res) => {
  res.send("WebSocket server running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});