const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const { PublicKey } = require("@solana/web3.js");
const nacl = require("tweetnacl");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const MESSAGES_FILE = "messages.json";

async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function saveMessages(messages) {
  await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

wss.on("connection", async (ws) => {
  console.log("New client connected");
  const messages = await loadMessages();
  messages.forEach((msg) => ws.send(JSON.stringify(msg)));
  ws.on("message", async (data) => {
    try {
      const { user, rank, text, signature, publicKey } = JSON.parse(data);
      if (!user || !rank || !text || !signature || !publicKey) {
        console.error("Invalid message format");
        return;
      }
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
      const msg = {
        user,
        rank,
        text,
        publicKey,
        timestamp: new Date().toLocaleString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      };
      console.log(`Received: ${msg.rank} ${msg.user}: ${msg.text} at ${msg.timestamp}`);
      const messages = await loadMessages();
      messages.push(msg);
      await saveMessages(messages);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(msg));
        }
      });
    } catch (err) {
      console.error("Message processing error:", err);
    }
  });
  ws.on("close", () => console.log("Client disconnected"));
  ws.on("error", (err) => console.error("WebSocket error:", err));
});

app.get("/", (req, res) => res.send("WebSocket server running"));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));