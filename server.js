require("dotenv").config();
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const { Keypair, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } = require("@solana/web3.js");
const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, createTransferInstruction } = require("@solana/spl-token");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "user.json");
const SUGGESTIONS_FILE = path.join(__dirname, "suggestions.json");

// Solana connection
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// Load and validate the donation wallet private key
const DONATION_WALLET_PRIVATE_KEY = process.env.DEV_WALLET_PRIVATE_KEY; // Using DEV_WALLET_PRIVATE_KEY from .env as per your file
if (!DONATION_WALLET_PRIVATE_KEY) {
  throw new Error("DEV_WALLET_PRIVATE_KEY not set in .env (used for DONATION_WALLET)");
}
const donationWalletPrivateKey = Uint8Array.from(JSON.parse(DONATION_WALLET_PRIVATE_KEY));
if (donationWalletPrivateKey.length !== 64) {
  throw new Error(`Invalid private key size: expected 64 bytes, got ${donationWalletPrivateKey.length}`);
}
const donationWallet = Keypair.fromSecretKey(donationWalletPrivateKey);
console.log("Donation Wallet Public Key:", donationWallet.publicKey.toBase58()); // Should match Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF

// Admin wallet (creator wallet)
const ADMIN_WALLET = new PublicKey("Cj64jfCQ2dR5Utf62nMnmEq8fjerAk4u1mZY1Hv53QZA");

// Initialize files
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
}

// Load messages
async function loadMessages() {
  try {
    const data = await fs.readFile(MESSAGES_FILE, "utf8");
    const messages = JSON.parse(data);
    console.log(`Loaded ${messages.length} messages from messages.json`);
    return messages;
  } catch (err) {
    console.error("Error loading messages:", err);
    return [];
  }
}

// Save messages
async function saveMessages(messages) {
  try {
    await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    console.log(`Saved ${messages.length} messages to messages.json`);
  } catch (err) {
    console.error("Error saving messages:", err);
  }
}

// Load users
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading users:", err);
    return {};
  }
}

// Save users
async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log("Saved users to user.json");
  } catch (err) {
    console.error("Error saving users:", err);
  }
}

// Load suggestions
async function loadSuggestions() {
  try {
    const data = await fs.readFile(SUGGESTIONS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading suggestions:", err);
    return [];
  }
}

// Save suggestions
async function saveSuggestions(suggestions) {
  try {
    await fs.writeFile(SUGGESTIONS_FILE, JSON.stringify(suggestions, null, 2));
    console.log(`Saved ${suggestions.length} suggestions to suggestions.json`);
  } catch (err) {
    console.error("Error saving suggestions:", err);
  }
}

initFiles();

// Enable CORS for GitHub Pages origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://app.solmemetics.com");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Endpoint to view messages.json
app.get("/messages", async (req, res) => {
  try {
    const messages = await loadMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).send("Error reading messages");
  }
});

// Endpoint to view user.json
app.get("/users", async (req, res) => {
  try {
    const users = await loadUsers();
    res.json(users);
  } catch (err) {
    res.status(500).send("Error reading users");
  }
});

// Endpoint to set username
app.post("/set-username", async (req, res) => {
  try {
    const { wallet, username } = req.body;
    if (!wallet || !username) {
      console.log("Missing wallet or username in request");
      return res.status(400).send("Wallet and username required");
    }
    console.log(`Received request to set username ${username} for wallet ${wallet}`);
    const users = await loadUsers();
    users[wallet] = username;
    await saveUsers(users);
    console.log(`Username ${username} set for wallet ${wallet}`);
    res.send("Username set");
  } catch (err) {
    console.error("Error setting username:", err);
    res.status(500).send("Error setting username");
  }
});

// Endpoint to view suggestions.json
app.get("/suggestions", async (req, res) => {
  try {
    const suggestions = await loadSuggestions();
    res.json(suggestions);
  } catch (err) {
    res.status(500).send("Error reading suggestions");
  }
});

// Endpoint to submit suggestion and process donation
app.post("/submit-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion, token, amount } = req.body;
    if (!wallet || !suggestion || !token || amount === undefined || amount <= 0) {
      return res.status(400).send("Wallet, suggestion, token, and valid amount required");
    }
    const users = await loadUsers();
    const username = users[wallet] || wallet.slice(0, 6);
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const userPublicKey = new PublicKey(wallet);
    const tokenMint = new PublicKey(token);

    // Create transaction to transfer to donation wallet
    let transaction = new Transaction();
    if (token === "So11111111111111111111111111111111111111112") { // SOL
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userPublicKey,
          toPubkey: donationWallet.publicKey, // Donation wallet as recipient
          lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        })
      );
    } else { // Token
      const userATA = await getAssociatedTokenAddress(tokenMint, userPublicKey);
      const donationATA = await getAssociatedTokenAddress(tokenMint, donationWallet.publicKey);
      const createDonationATAIx = createAssociatedTokenAccountInstruction(
        donationWallet.publicKey,
        donationATA,
        donationWallet.publicKey,
        tokenMint
      );
      const transferIx = createTransferInstruction(
        userATA,
        donationATA,
        userPublicKey,
        Math.floor(amount * 10 ** 6), // Assuming 6 decimals for tokens like SMM/USDC
        [],
        TOKEN_PROGRAM_ID
      );
      transaction.add(createDonationATAIx, transferIx);
    }

    // Set recent blockhash and fee payer
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = userPublicKey;

    // Serialize transaction (user must sign)
    const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");

    // Store suggestion
    const newSuggestion = { username, wallet, suggestion, token, amount, timestamp: new Date().toISOString() };
    const suggestions = await loadSuggestions();
    suggestions.push(newSuggestion);
    await saveSuggestions(suggestions);

    res.json({ message: "Suggestion submitted, please sign transaction", transaction: serializedTx });
  } catch (err) {
    console.error("Error submitting suggestion:", err);
    res.status(500).send("Error submitting suggestion");
  }
});

wss.on("connection", async (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}`);

  // Send existing messages
  const messages = await loadMessages();
  messages.forEach((msg) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
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
        console.log(`Received: ${msg.rank} ${username}: ${msg.text}`);
        const messages = await loadMessages();
        messages.push(chatMessage);
        await saveMessages(messages);
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(chatMessage));
          }
        });
      } else if (msg.type === "delete" && msg.index !== undefined) {
        const messages = await loadMessages();
        if (messages[msg.index]) {
          console.log(`Delete request for message at index ${msg.index}`);
          messages.splice(msg.index, 1);
          await saveMessages(messages);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "delete", index: msg.index }));
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});