const WebSocket = require("ws");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("New client connected");
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (!msg.user || !msg.rank || !msg.text) return;
      console.log(`Received: ${msg.rank} ${msg.user}: ${msg.text}`);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(msg));
        }
      });
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