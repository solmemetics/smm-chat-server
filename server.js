require("dotenv").config();
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const { Keypair, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey, TOKEN_PROGRAM_ID } = require("@solana/web3.js");
const { createAssociatedTokenAccountInstruction, createTransferInstruction } = require("@solana/spl-token");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "user.json");
const SUGGESTIONS_FILE = path.join(__dirname, "suggestions.json");

// Solana connection
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// ATA function
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGVdDGrw5uGzXBNzMuGZvx7bGTp4GVRZBe8KMP");
async function getAssociatedTokenAddress(mint, owner) {
  if (!mint || !owner) {
    console.error("getAssociatedTokenAddress: Invalid input", {
      mint: mint?.toBase58?.() || "undefined",
      owner: owner?.toBase58?.() || "undefined",
    });
    throw new Error("Mint or owner is undefined");
  }
  if (!(mint instanceof PublicKey) || !(owner instanceof PublicKey)) {
    console.error("getAssociatedTokenAddress: Invalid PublicKey", {
      mint: mint?.toBase58?.() || "not a PublicKey",
      owner: owner?.toBase58?.() || "not a PublicKey",
    });
    throw new Error("Mint or owner is not a valid PublicKey");
  }
  try {
    const mintStr = mint.toBase58();
    const ownerStr = owner.toBase58();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintStr) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ownerStr)) {
      console.error("Invalid PublicKey format", { mint: mintStr, owner: ownerStr });
      throw new Error("Invalid PublicKey format");
    }
    const mintBytes = mint.toBytes();
    const ownerBytes = owner.toBytes();
    if (!mintBytes || mintBytes.length !== 32 || !ownerBytes || ownerBytes.length !== 32) {
      console.error("PublicKey toBytes() failed", { mint: mintStr, owner: ownerStr, mintBytesLength: mintBytes?.length, ownerBytesLength: ownerBytes?.length });
      throw new Error("Invalid PublicKey: toBytes() returned invalid data");
    }
    console.log("Validating PublicKey buffers:", { mint: mintBytes.length, owner: ownerBytes.length });
    console.log("Attempting toBuffer for mint:", mintStr);
    const mintBuffer = mint.toBuffer();
    console.log("Attempting toBuffer for owner:", ownerStr);
    const ownerBuffer = owner.toBuffer();
    console.log("Attempting toBuffer for TOKEN_PROGRAM_ID");
    const tokenProgramBuffer = TOKEN_PROGRAM_ID.toBuffer();
    if (!mintBuffer || !ownerBuffer || !tokenProgramBuffer) {
      console.error("toBuffer() returned null", {
        mintBuffer: !!mintBuffer,
        ownerBuffer: !!ownerBuffer,
        tokenProgramBuffer: !!tokenProgramBuffer,
      });
      throw new Error("toBuffer() failed for one or more PublicKeys");
    }
    console.log("Computing ATA for mint:", mintStr, "owner:", ownerStr);
    const [ata] = await PublicKey.findProgramAddress(
      [ownerBuffer, tokenProgramBuffer, mintBuffer],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log("Computed ATA:", ata.toBase58());
    return ata;
  } catch (err) {
    console.error("Error in findProgramAddress:", err.message, {
      mint: mint?.toBase58?.() || "undefined",
      owner: owner?.toBase58?.() || "undefined",
    });
    throw new Error(`Failed to compute ATA: ${err.message}`);
  }
}

// Load and validate the donation wallet private key
const DONATION_WALLET_PRIVATE_KEY = process.env.DONATION_WALLET_PRIVATE_KEY;
console.log("Raw DONATION_WALLET_PRIVATE_KEY:", DONATION_WALLET_PRIVATE_KEY);
if (!DONATION_WALLET_PRIVATE_KEY) {
  console.error("Environment Error: DONATION_WALLET_PRIVATE_KEY not set in .env");
  process.exit(1);
}
let donationWalletPrivateKey;
try {
  donationWalletPrivateKey = Uint8Array.from(JSON.parse(DONATION_WALLET_PRIVATE_KEY));
} catch (err) {
  console.error("Parsing Error: Failed to parse DONATION_WALLET_PRIVATE_KEY:", err.message);
  console.error("Ensure the .env file contains a valid JSON array with 64 numbers, e.g., [123,45,67,...,89]");
  process.exit(1);
}
if (donationWalletPrivateKey.length !== 64) {
  console.error(`Validation Error: Invalid private key size: expected 64 bytes, got ${donationWalletPrivateKey.length}`);
  process.exit(1);
}
let donationWallet;
try {
  donationWallet = Keypair.fromSecretKey(donationWalletPrivateKey);
  console.log("Donation Wallet Public Key:", donationWallet.publicKey.toBase58());
  if (donationWallet.publicKey.toBase58() !== "Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF") {
    console.error("Validation Error: Derived public key does not match expected Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF");
    process.exit(1);
  }
} catch (err) {
  console.error("Keypair Error: Failed to create Keypair from secret key:", err.message);
  console.error("Ensure the private key corresponds to a valid Solana keypair for Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF");
  process.exit(1);
}

// Admin wallet
const ADMIN_WALLET = new PublicKey("Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF");

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

// Enable CORS
app.use((req, res, next) => {
  const allowedOrigins = ["https://app.solmemetics.com", "http://localhost:3000"];
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

// Endpoint to view messages.json
app.get("/messages", async (req, res) => {
  try {
    const messages = await loadMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Error reading messages" });
  }
});

// Endpoint to view user.json
app.get("/users", async (req, res) => {
  try {
    const users = await loadUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Error reading users" });
  }
});

// Endpoint to set username
app.post("/set-username", async (req, res) => {
  try {
    const { wallet, username } = req.body;
    if (!wallet || !username) {
      console.log("Missing wallet or username in request");
      return res.status(400).json({ error: "Wallet and username required" });
    }
    const users = await loadUsers();
    if (users[wallet] && wallet !== ADMIN_WALLET.toBase58()) {
      return res.status(403).json({ error: "Username already set. Only admin can change it." });
    }
    console.log(`Received request to set username ${username} for wallet ${wallet}`);
    users[wallet] = username;
    await saveUsers(users);
    console.log(`Username ${username} set for wallet ${wallet}`);
    res.json({ message: "Username set" });
  } catch (err) {
    console.error("Error setting username:", err);
    res.status(500).json({ error: "Error setting username" });
  }
});

// Endpoint to view suggestions.json
app.get("/suggestions", async (req, res) => {
  try {
    const suggestions = await loadSuggestions();
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: "Error reading suggestions" });
  }
});

// Debug endpoint for ATA
app.post("/test-ata", async (req, res) => {
  try {
    const { mint, owner } = req.body;
    console.log("Received /test-ata request:", { mint, owner });
    if (!mint || !owner) {
      return res.status(400).json({ error: "Mint and owner required" });
    }
    let mintPubkey, ownerPubkey;
    try {
      mintPubkey = new PublicKey(mint);
      ownerPubkey = new PublicKey(owner);
    } catch (err) {
      console.error("Invalid PublicKey in /test-ata:", err.message, { mint, owner });
      return res.status(400).json({ error: "Invalid mint or owner address" });
    }
    try {
      const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);
      res.json({ success: true, ata: ata.toBase58() });
    } catch (err) {
      console.error("Error computing ATA in /test-ata:", err.message);
      res.status(500).json({ error: `Failed to compute ATA: ${err.message}` });
    }
  } catch (err) {
    console.error("Unexpected error in /test-ata:", err);
    res.status(500).json({ error: `Unexpected error: ${err.message}` });
  }
});

// Endpoint to prepare suggestion transaction
app.post("/submit-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion, token, amount } = req.body;
    console.log("Received /submit-suggestion request:", { wallet, suggestion, token, amount });

    // Validate inputs
    if (!wallet || !suggestion || !token || amount === undefined || amount <= 0) {
      console.log("Validation failed: Missing or invalid parameters");
      return res.status(400).json({ error: "Wallet, suggestion, token, and valid amount required" });
    }

    // Validate wallet address
    let userPublicKey;
    try {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        throw new Error("Invalid wallet address format");
      }
      userPublicKey = new PublicKey(wallet);
      const userBytes = userPublicKey.toBytes();
      if (!userBytes || userBytes.length !== 32) {
        throw new Error("Invalid wallet PublicKey: toBytes() failed");
      }
      console.log("Validated userPublicKey:", userPublicKey.toBase58());
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { wallet });
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Validate token mint
    let tokenMint;
    try {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token)) {
        throw new Error("Invalid token mint address format");
      }
      tokenMint = new PublicKey(token);
      const mintBytes = tokenMint.toBytes();
      if (!mintBytes || mintBytes.length !== 32) {
        throw new Error("Invalid token mint PublicKey: toBytes() failed");
      }
      console.log("Validated tokenMint:", tokenMint.toBase58());
    } catch (err) {
      console.error("Invalid token mint:", err.message, { token });
      return res.status(400).json({ error: "Invalid token mint address" });
    }

    // Validate donation wallet
    if (!donationWallet || !donationWallet.publicKey) {
      console.error("Donation wallet not initialized");
      return res.status(500).json({ error: "Server configuration error: Donation wallet not initialized" });
    }
    try {
      const donationBytes = donationWallet.publicKey.toBytes();
      if (!donationBytes || donationBytes.length !== 32) {
        throw new Error("Invalid donation wallet PublicKey: toBytes() failed");
      }
      console.log("Donation wallet public key:", donationWallet.publicKey.toBase58());
    } catch (err) {
      console.error("Donation wallet validation failed:", err.message);
      return res.status(500).json({ error: "Server configuration error: Invalid donation wallet" });
    }

    const users = await loadUsers();
    const username = users[wallet] || wallet.slice(0, 6);

    let transaction = new Transaction();
    if (token === "So11111111111111111111111111111111111111112") { // SOL
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userPublicKey,
          toPubkey: donationWallet.publicKey,
          lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        })
      );
    } else { // Token
      let userATA, donationATA;
      try {
        console.log("Fetching user ATA for:", { mint: tokenMint.toBase58(), owner: userPublicKey.toBase58() });
        userATA = await getAssociatedTokenAddress(tokenMint, userPublicKey);
        console.log("Fetching donation ATA for:", { mint: tokenMint.toBase58(), owner: donationWallet.publicKey.toBase58() });
        donationATA = await getAssociatedTokenAddress(tokenMint, donationWallet.publicKey);
        console.log("User ATA:", userATA.toBase58(), "Donation ATA:", donationATA.toBase58());
      } catch (err) {
        console.error("Error getting ATA:", err.message);
        return res.status(500).json({ error: "Failed to get associated token address" });
      }

      // Check if donation ATA exists
      const donationATAInfo = await connection.getAccountInfo(donationATA);
      if (!donationATAInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            donationWallet.publicKey, // Payer
            donationATA,
            donationWallet.publicKey, // Owner
            tokenMint
          )
        );
      }

      // Get token decimals
      let decimals;
      try {
        const mintInfo = await connection.getParsedAccountInfo(tokenMint);
        if (!mintInfo.value?.data?.parsed?.info?.decimals) {
          throw new Error("Unable to fetch token decimals");
        }
        decimals = mintInfo.value.data.parsed.info.decimals;
        console.log("Token decimals:", decimals);
      } catch (err) {
        console.error("Error getting token decimals:", err.message);
        return res.status(500).json({ error: "Failed to get token decimals" });
      }

      try {
        transaction.add(
          createTransferInstruction(
            userATA,
            donationATA,
            userPublicKey,
            Math.floor(amount * 10 ** decimals),
            [],
            TOKEN_PROGRAM_ID
          )
        );
      } catch (err) {
        console.error("Error creating transfer instruction:", err.message);
        return res.status(500).json({ error: "Failed to create token transfer instruction" });
      }
    }

    try {
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = userPublicKey;
      const serializedTx = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      console.log("Transaction serialized, sending to client");
      res.json({ message: "Please sign transaction", transaction: serializedTx, suggestionData: { username, wallet, suggestion, token, amount } });
    } catch (err) {
      console.error("Error serializing transaction:", err.message);
      return res.status(500).json({ error: "Failed to process transaction" });
    }
  } catch (err) {
    console.error("Unexpected error in /submit-suggestion:", err);
    res.status(500).json({ error: `Unexpected error: ${err.message}` });
  }
});

// Endpoint to confirm suggestion after transaction
app.post("/confirm-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion, token, amount, signature } = req.body;
    console.log("Received /confirm-suggestion request:", { wallet, suggestion, token, amount, signature });

    // Validate inputs
    if (!wallet || !suggestion || !token || amount === undefined || !signature) {
      console.log("Validation failed: Missing parameters in /confirm-suggestion");
      return res.status(400).json({ error: "Wallet, suggestion, token, amount, and signature required" });
    }

    // Verify transaction signature
    try {
      const result = await connection.getSignatureStatus(signature);
      if (!result.value || result.value.confirmationStatus !== "confirmed") {
        console.error("Transaction not confirmed:", signature);
        return res.status(400).json({ error: "Transaction not confirmed" });
      }
      console.log("Transaction confirmed:", signature);
    } catch (err) {
      console.error("Error verifying transaction:", err.message);
      return res.status(400).json({ error: "Failed to verify transaction" });
    }

    const users = await loadUsers();
    const username = users[wallet] || wallet.slice(0, 6);
    const newSuggestion = { username, wallet, suggestion, token, amount, timestamp: new Date().toISOString(), signature };
    const suggestions = await loadSuggestions();
    suggestions.push(newSuggestion);
    await saveSuggestions(suggestions);

    res.json({ message: "Suggestion confirmed and saved" });
  } catch (err) {
    console.error("Error in /confirm-suggestion:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

wss.on("connection", async (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}`);

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

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});