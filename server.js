const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "user.json");
const SUGGESTIONS_FILE = path.join(__dirname, "suggestions.json");
const DELETED_SUGGESTIONS_FILE = path.join(__dirname, "deleted_suggestions.json");
const POLLS_FILE = path.join(__dirname, "polls.json");

const ADMIN_WALLET = new PublicKey("Cj64jfCQ2dR5Utf62nMnmEq8fjerAk4u1mZY1Hv53QZA");

const RPC_ENDPOINTS = [
  "https://silent-fluent-diamond.solana-mainnet.quiknode.pro/bdf6a6133f8736f5bf9097f4628841fe18b60bcc",
  clusterApiUrl("mainnet-beta"),
  "https://api.mainnet-beta.solana.com"
];

// Multer for avatar uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, "public", "avatars"),
  filename: (req, file, cb) => {
    cb(null, `${req.body.wallet}.png`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

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
    await fs.mkdir(path.join(__dirname, "public", "avatars"), { recursive: true });
    for (const file of [MESSAGES_FILE, USERS_FILE, SUGGESTIONS_FILE, DELETED_SUGGESTIONS_FILE, POLLS_FILE]) {
      try {
        await fs.access(file);
        console.log(`${path.basename(file)} exists`);
      } catch {
        console.log(`Creating ${path.basename(file)}`);
        await fs.writeFile(file, JSON.stringify(file === USERS_FILE ? {} : []));
      }
    }
  } catch (err) {
    console.error("Error initializing files:", err);
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

async function loadPolls() {
  try {
    const data = await fs.readFile(POLLS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading polls:", err);
    return [];
  }
}

async function savePolls(polls) {
  try {
    await fs.writeFile(POLLS_FILE, JSON.stringify(polls, null, 2));
    console.log(`Saved ${polls.length} polls`);
  } catch (err) {
    console.error("Error saving polls:", err);
  }
}

initFiles();

// Serve static files, including avatars
app.use("/avatars", express.static(path.join(__dirname, "public", "avatars")));
app.use(express.static(path.join(__dirname, "public")));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://app.solmemetics.com",
    "http://localhost:3000",
    "https://solmemetics.github.io",
    "https://smm-chat-server.onrender.com"
  ];
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
    console.error("Error in /messages:", err);
    res.status(500).json({ error: "Error reading messages" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const users = await loadUsers();
    res.json(users);
  } catch (err) {
    console.error("Error in /users:", err);
    res.status(500).json({ error: "Error reading users" });
  }
});

app.post("/set-username", async (req, res) => {
  try {
    const { wallet, username } = req.body;
    if (!wallet || !username) {
      return res.status(400).json({ error: "Wallet and username required" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const users = await loadUsers();
    if (users[wallet]?.username && wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Username already set. Only admin can change it." });
    }
    users[wallet] = { ...users[wallet], username };
    await saveUsers(users);
    console.log(`Username set for ${wallet}: ${username}`);
    res.json({ message: "Username set" });
  } catch (err) {
    console.error("Error in /set-username:", err);
    res.status(500).json({ error: "Error setting username" });
  }
});

app.post("/set-bio", async (req, res) => {
  try {
    const { wallet, bio } = req.body;
    if (!wallet || !bio) {
      return res.status(400).json({ error: "Wallet and bio required" });
    }
    if (bio.length > 100) {
      return res.status(400).json({ error: "Bio must be 100 characters or less" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const users = await loadUsers();
    if (users[wallet]?.bio && wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Bio already set. Only admin can change it." });
    }
    users[wallet] = { ...users[wallet], bio };
    await saveUsers(users);
    console.log(`Bio set for ${wallet}: ${bio}`);
    res.json({ message: "Bio set" });
  } catch (err) {
    console.error("Error in /set-bio:", err);
    res.status(500).json({ error: "Error setting bio" });
  }
});

app.post("/upload-avatar", upload.single("avatar"), async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet || !req.file) {
      return res.status(400).json({ error: "Wallet and avatar file required" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const users = await loadUsers();
    if (users[wallet]?.avatar && wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Avatar already set. Only admin can change it." });
    }
    const baseUrl = process.env.NODE_ENV === "production"
      ? "https://smm-chat-server.onrender.com"
      : "http://localhost:3000";
    const avatarUrl = `${baseUrl}/avatars/${wallet}.png`;
    users[wallet] = { ...users[wallet], avatar: avatarUrl };
    await saveUsers(users);
    console.log(`Avatar uploaded for ${wallet}: ${avatarUrl}`);
    res.json({ message: "Avatar uploaded", avatarUrl });
  } catch (err) {
    console.error("Error in /upload-avatar:", err);
    res.status(500).json({ error: err.message || "Error uploading avatar" });
  }
});

app.get("/suggestions", async (req, res) => {
  try {
    const wallet = req.query.wallet;
    if (!wallet) {
      return res.status(400).json({ error: "Wallet parameter required" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const suggestions = await loadSuggestions();
    const deletedSuggestions = await loadDeletedSuggestions();
    if (wallet === ADMIN_WALLET.toBase58()) {
      return res.json([...suggestions, ...deletedSuggestions]);
    }
    const userSuggestions = suggestions.filter(sug => sug.wallet === wallet);
    res.json(userSuggestions);
  } catch (err) {
    console.error("Error in /suggestions:", err);
    res.status(500).json({ error: "Error reading suggestions" });
  }
});

app.post("/submit-free-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion } = req.body;
    if (!wallet || !suggestion) {
      return res.status(400).json({ error: "Wallet and suggestion required" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const users = await loadUsers();
    const username = users[wallet]?.username || wallet.slice(0, 6);
    const avatar = users[wallet]?.avatar || null;
    const bio = users[wallet]?.bio || null;
    const newSuggestion = { username, wallet, suggestion, avatar, bio, timestamp: new Date().toISOString() };
    const suggestions = await loadSuggestions();
    suggestions.push(newSuggestion);
    await saveSuggestions(suggestions);
    console.log(`Suggestion submitted by ${wallet}: ${suggestion}`);
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
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
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
    console.log(`Suggestion deleted by ${wallet} at index ${index}`);
    res.json({ message: "Suggestion deleted" });
  } catch (err) {
    console.error("Error in /delete-suggestion:", err);
    res.status(500).json({ error: "Failed to delete suggestion" });
  }
});

app.get("/polls", async (req, res) => {
  try {
    const polls = await loadPolls();
    res.json(polls);
  } catch (err) {
    console.error("Error in /polls:", err);
    res.status(500).json({ error: "Error reading polls" });
  }
});

app.post("/create-poll", async (req, res) => {
  try {
    const { question, options, wallet } = req.body;
    if (!question || !options || options.length < 2 || !wallet) {
      return res.status(400).json({ error: "Question, at least two options, and wallet required" });
    }
    if (wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Only admin can create polls" });
    }
    const polls = await loadPolls();
    const newPoll = {
      question,
      options: options.map(opt => ({ option: opt, votes: 0 })),
      voters: [],
      timestamp: new Date().toISOString()
    };
    polls.push(newPoll);
    await savePolls(polls);
    console.log(`Poll created by ${wallet}: ${question}`);
    res.json({ message: "Poll created" });
  } catch (err) {
    console.error("Error in /create-poll:", err);
    res.status(500).json({ error: "Failed to create poll" });
  }
});

app.post("/vote", async (req, res) => {
  try {
    const { pollIndex, optionIndex, wallet } = req.body;
    if (pollIndex === undefined || optionIndex === undefined || !wallet) {
      return res.status(400).json({ error: "Poll index, option index, and wallet required" });
    }
    try {
      new PublicKey(wallet); // Validate wallet address
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const polls = await loadPolls();
    if (pollIndex < 0 || pollIndex >= polls.length) {
      return res.status(400).json({ error: "Invalid poll index" });
    }
    if (optionIndex < 0 || optionIndex >= polls[pollIndex].options.length) {
      return res.status(400).json({ error: "Invalid option index" });
    }
    if (polls[pollIndex].voters.includes(wallet)) {
      return res.status(403).json({ error: "Already voted" });
    }
    polls[pollIndex].options[optionIndex].votes += 1;
    polls[pollIndex].voters.push(wallet);
    await savePolls(polls);
    console.log(`Vote recorded for ${wallet} on poll ${pollIndex}, option ${optionIndex}`);
    res.json({ message: "Vote recorded" });
  } catch (err) {
    console.error("Error in /vote:", err);
    res.status(500).json({ error: "Failed to record vote" });
  }
});

wss.on("connection", async (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}`);
  const messages = await loadMessages();
  const users = await loadUsers();
  messages.forEach((msg) => {
    if (ws.readyState === WebSocket.OPEN) {
      const username = users[msg.originalWallet]?.username || msg.originalWallet.slice(0, 6);
      const avatar = users[msg.originalWallet]?.avatar || null;
      const bio = users[msg.originalWallet]?.bio || null;
      ws.send(JSON.stringify({ type: "chat", ...msg, user: username, avatar, bio }));
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "chat" && msg.user && msg.rank && msg.text) {
        const users = await loadUsers();
        const username = users[msg.user]?.username || msg.user.slice(0, 6);
        const avatar = users[msg.user]?.avatar || null;
        const bio = users[msg.user]?.bio || null;
        const chatMessage = {
          user: username,
          rank: msg.rank,
          text: msg.text,
          timestamp: new Date().toISOString(),
          originalWallet: msg.user,
          avatar,
          bio,
          pinned: false
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
      } else if (msg.type === "pin_message" && msg.index !== undefined) {
        if (msg.user !== ADMIN_WALLET.toBase58()) {
          console.log(`Unauthorized pin attempt by ${msg.user}`);
          return;
        }
        const messages = await loadMessages();
        if (messages[msg.index]) {
          messages[msg.index].pinned = true;
          const [pinnedMessage] = messages.splice(msg.index, 1);
          messages.unshift(pinnedMessage);
          await saveMessages(messages);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "pin_message", index: 0 }));
            }
          });
        }
      }
    } catch (err) {
      console.error("Invalid message format in WebSocket:", err);
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