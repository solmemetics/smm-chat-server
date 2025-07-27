const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "user.json");
const SUGGESTIONS_FILE = path.join(__dirname, "suggestions.json");
const DELETED_SUGGESTIONS_FILE = path.join(__dirname, "deleted_suggestions.json");

const ADMIN_WALLET = new PublicKey("Cj64jfCQ2dR5Utf62nMnmEq8fjerAk4u1mZY1Hv53QZA");

const RPC_ENDPOINTS = [
  "https://silent-fluent-diamond.solana-mainnet.quiknode.pro/bdf6a6133f8736f5bf9097f4628841fe18b60bcc",
  clusterApiUrl("mainnet-beta"),
  "https://api.mainnet-beta.solana.com"
];

async function getConnection(attempt = 0) {
  const rpc = RPC_ENDPOINTS[attempt];
  try {
    const connection = new Connection(rpc, { commitment: "confirmed" });
    await connection.getSlot();
    console.log(`Connected to RPC: ${rpc}`);
    return connection;
  } catch (err) {
    console.error(`RPC ${rpc} failed:`, err);
    if (attempt < RPC_ENDPOINTS.length - 1) {
      return getConnection(attempt + 1);
    }
    throw new Error("All RPC endpoints failed.");
  }
}

async function initFiles() {
  try {
    await fs.access(MESSAGES_FILE);
    console.log("Messages file exists");
  } catch {
    console.log("Creating new messages file");
    await fs.writeFile(MESSAGES_FILE, JSON.stringify([]));
  }
  try {
    await fs.access(USERS_FILE);
    console.log("Users file exists");
  } catch {
    console.log("Creating new users file");
    await fs.writeFile(USERS_FILE, JSON.stringify({}));
  }
  try {
    await fs.access(SUGGESTIONS_FILE);
    console.log("Suggestions file exists");
  } catch {
    console.log("Creating new suggestions file");
    await fs.writeFile(SUGGESTIONS_FILE, JSON.stringify([]));
  }
  try {
    await fs.access(DELETED_SUGGESTIONS_FILE);
    console.log("Deleted suggestions file exists");
  } catch {
    console.log("Creating new deleted suggestions file");
    await fs.writeFile(DELETED_SUGGESTIONS_FILE, JSON.stringify([]));
  }
}

async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading messages:", err);
    return [];
  }
}

async function saveMessages(messages) {
  try {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    console.log(`Saved ${messages.length} messages`);
  } catch (err) {
    console.error("Error saving messages:", err);
  }
}

async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading users:", err);
    return {};
  }
}

async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log("Saved users");
  } catch (err) {
    console.error("Error saving users:", err);
  }
}

async function loadSuggestions() {
  try {
    const data = await fs.readFile(SUGGESTIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading suggestions:", err);
    return [];
  }
}

async function saveSuggestions(suggestions) {
  try {
    await fs.writeFile(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
    console.log(`Saved ${suggestions.length} suggestions`);
  } catch (err) {
    console.error("Error saving suggestions:", err);
  }
}

async function loadDeletedSuggestions() {
  try {
    const data = await fs.readFile(DELETED_SUGGESTIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading deleted suggestions:", err);
    return [];
  }
}

async function saveDeletedSuggestions(deletedSuggestions) {
  try {
    await fs.writeFile(DELETED_SUGGESTIONS_FILE, JSON.stringify(deletedSuggestions, null, 2));
    console.log(`Saved ${deletedSuggestions.length} deleted suggestions`);
  } catch (err) {
    console.error("Error saving deleted suggestions:", err);
  }
}

initFiles();

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  const allowedOrigins = ["https://app.solmemetics.com", "http://localhost:3000", "https://solmemetics.github.io"];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());

app.get("/messages", async (req, res) => {
  try {
    const messages = await loadMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Error reading messages" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const users = await loadUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Error reading users" });
  }
});

app.post("/set-username", async (req, res) => {
  try {
    const { wallet, username } = req.body;
    if (!wallet || !username) {
      return res.status(400).json({ error: "Wallet and username required" });
    }
    const users = await loadUsers();
    if (users[wallet] && wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Username already set. Only admin can change it." });
    }
    users[wallet] = username;
    await saveUsers(users);
    res.json({ message: "Username set" });
  } catch (err) {
    console.error("Error setting username:", err);
    res.status(500).json({ error: "Error setting username" });
  }
});

app.get("/suggestions", async (req, res) => {
  try {
    const wallet = req.query.wallet;
    if (!wallet) {
      return res.status(400).json({ error: "Wallet parameter required" });
    }
    const suggestions = await loadSuggestions();
    const deletedSuggestions = await loadDeletedSuggestions();
    if (wallet === ADMIN_WALLET.toBase58()) {
      return res.json([...suggestions, ...deletedSuggestions]);
    }
    const userSuggestions = suggestions.filter(sug => sug.wallet === wallet);
    res.json(userSuggestions);
  } catch (err) {
    console.error("Error reading suggestions:", err);
    res.status(500).json({ error: "Error reading suggestions" });
  }
});

app.post("/submit-free-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion } = req.body;
    if (!wallet || !suggestion) {
      return res.status(400).json({ error: "Wallet and suggestion required" });
    }
    let userPublicKey;
    try {
      userPublicKey = new PublicKey(wallet);
    } catch (err) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const users = await loadUsers();
    const username = users[wallet] || wallet.slice(0, 6);
    const newSuggestion = { username, wallet, suggestion, timestamp: new Date().toISOString() };
    const suggestions = await loadSuggestions();
    suggestions.push(newSuggestion);
    await saveSuggestions(suggestions);
    res.json({ message: "Suggestion saved", suggestion: newSuggestion });
  } catch (err) {
    console.error("Error in /submit-free-suggestion:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

app.post("/delete-suggestion", async (req, res) => {
  try {
    const { index, wallet } = req.body;
    if (index === undefined || !wallet) {
      return res.status(400).json({ error: "Index and wallet required" });
    }
    const suggestions = await loadSuggestions();
    if (index < 0 || index >= suggestions.length) {
      return res.status(400).json({ error: "Invalid suggestion index" });
    }
    if (wallet !== ADMIN_WALLET.toBase58() && suggestions[index].wallet !== wallet) {
      return res.status(403).json({ error: "Unauthorized to delete this suggestion" });
    }
    const [deletedSuggestion] = suggestions.splice(index, 1);
    await saveSuggestions(suggestions);
    const deletedSuggestions = await loadDeletedSuggestions();
    deletedSuggestions.push(deletedSuggestion);
    await saveDeletedSuggestions(deletedSuggestions);
    res.json({ message: "Suggestion deleted" });
  } catch (err) {
    console.error("Error deleting suggestion:", err);
    res.status(500).json({ error: "Failed to delete suggestion" });
  }
});

wss.on("connection", async (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}`);
  const messages = await loadMessages();
  messages.forEach((msg) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", ...msg }));
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "chat" && msg.user && msg.rank && msg.text) {
        const users = await loadUsers();
        const username = users[msg.user] || msg.user.slice(0, 6);
        const chatMessage = {
          user: username,
          rank: msg.rank,
          text: msg.text,
          timestamp: new Date().toISOString(),
          originalWallet: msg.user,
        };
        const messages = await loadMessages();
        messages.push(chatMessage);
        await saveMessages(messages);
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "chat", ...chatMessage }));
          }
        });
      } else if (msg.type === "delete_message" && msg.index !== undefined) {
        const messages = await loadMessages();
        if (msg.user !== ADMIN_WALLET.toBase58() && messages[msg.index]?.originalWallet !== msg.user) {
          console.log(`Unauthorized delete attempt by ${msg.user} for index ${msg.index}`);
          return;
        }
        if (messages[msg.index]) {
          messages.splice(msg.index, 1);
          await saveMessages(messages);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "delete_message", index: msg.index }));
            }
          });
        }
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

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});