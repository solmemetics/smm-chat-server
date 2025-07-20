const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { PublicKey, Connection, clusterApiUrl } = require("@solana/web3.js");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const TOKEN_MINT = new PublicKey("BbDK2SdFKstCuCjF152jWaRVmJMV7hHUW4xYvdMbjups");
const VIP_MINIMUM = 100000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");

// Initialize messages file if it doesn't exist
async function initMessagesFile() {
  try {
    await fs.access(MESSAGES_FILE);
  } catch {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify([]));
  }
}

// Load messages from file
async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading messages:", err);
    return [];
  }
}

// Save messages to file
async function saveMessages(messages) {
  try {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("Error saving messages:", err);
  }
}

// Solana connection
const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

async function verifyWalletAndBalance(publicKeyStr, signature, message) {
  try {
    // Verify signature
    const publicKey = new PublicKey(publicKeyStr);
    const signatureUint8 = bs58.decode(signature);
    const messageUint8 = new TextEncoder().encode(message);
    const isValid = nacl.sign.detached.verify(messageUint8, signatureUint8, publicKey.toBytes());
    if (!isValid) return false;

    // Verify SMM balance
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      mint: TOKEN_MINT,
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });
    let balance = 0;
    for (const { account } of tokenAccounts.value) {
      if (account.data.parsed.info.mint === TOKEN_MINT.toBase58()) {
        balance = parseFloat(account.data.parsed.info.tokenAmount.uiAmount);
        break;
      }
    }
    return balance >= VIP_MINIMUM;
  } catch (err) {
    console.error("Verification error:", err);
    return false;
  }
}

initMessagesFile();

wss.on("connection", async (ws) => {
  console.log("New client connected");

  // Load and send existing messages
  const messages = await loadMessages();
  messages.forEach((msg) => ws.send(JSON.stringify(msg)));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "auth") {
        // Handle authentication
        const isValid = await verifyWalletAndBalance(msg.publicKey, msg.signature, msg.sessionToken);
        if (isValid) {
          ws.isAuthenticated = true;
          ws.publicKey = msg.publicKey;
          ws.send(JSON.stringify({ type: "auth", status: "success" }));
          console.log(`Authenticated: ${msg.publicKey}`);
        } else {
          ws.send(JSON.stringify({ type: "auth", status: "failed" }));
          ws.close();
        }
      } else if (msg.type === "chat" && ws.isAuthenticated) {
        // Handle chat message
        if (!msg.user || !msg.rank || !msg.text) return;
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
          if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
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