require("dotenv").config();
const express = require("express");
const http = require("http");
const fs = require("fs").promises;
const path = require("path");
const WebSocket = require("ws");
const { Keypair, Connection, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction, clusterApiUrl } = require("@solana/web3.js");
const { createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require("@solana/spl-token");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "user.json");
const SUGGESTIONS_FILE = path.join(__dirname, "suggestions.json");
const CLAIMS_FILE = path.join(__dirname, "claims.json");

// Solana connection with fallback RPCs
const RPC_ENDPOINTS = [
  "https://silent-fluent-diamond.solana-mainnet.quiknode.pro/bdf6a6133f8736f5bf9097f4628841fe18b60bcc",
  clusterApiUrl("mainnet-beta"),
  "https://api.mainnet-beta.solana.com"
];

async function getConnection(attempt = 0) {
  const rpc = RPC_ENDPOINTS[attempt];
  try {
    const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: false });
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

// Custom ATA function
async function getAssociatedTokenAddressCustom(mintInput, ownerInput) {
  try {
    const mint = mintInput instanceof PublicKey ? mintInput : new PublicKey(mintInput);
    const owner = ownerInput instanceof PublicKey ? ownerInput : new PublicKey(ownerInput);
    const [ata] = await PublicKey.findProgramAddress(
      [
        owner.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log("Computed ATA:", ata.toBase58());
    return ata;
  } catch (e) {
    console.error("Error in getAssociatedTokenAddress:", e.message, { mint: mintInput, owner: ownerInput });
    throw new Error("Failed to compute ATA: " + e.message);
  }
}

// Fallback for createTransferInstruction
function createTransferInstruction(source, destination, owner, amount, multiSigners = [], programId = TOKEN_PROGRAM_ID) {
  console.log("Using fallback createTransferInstruction");
  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ];
  const data = Buffer.alloc(8 + 1);
  data.writeUInt8(3, 0); // Instruction index for Transfer
  data.writeBigUInt64LE(BigInt(amount), 1); // Amount
  return new TransactionInstruction({ keys, programId, data });
}

// Load and validate the reward wallet private key
const DONATION_WALLET_PRIVATE_KEY = process.env.DONATION_WALLET_PRIVATE_KEY;
if (!DONATION_WALLET_PRIVATE_KEY) {
  console.error("Environment Error: DONATION_WALLET_PRIVATE_KEY not set in .env");
  process.exit(1);
}
let donationWallet;
try {
  donationWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DONATION_WALLET_PRIVATE_KEY)));
  console.log("Reward Wallet Public Key:", donationWallet.publicKey.toBase58());
  if (donationWallet.publicKey.toBase58() !== "Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF") {
    console.error("Validation Error: Derived public key does not match expected Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF");
    process.exit(1);
  }
} catch (err) {
  console.error("Keypair Error: Failed to create Keypair from secret key:", err.message);
  process.exit(1);
}

// Admin wallet and token constants
const ADMIN_WALLET = new PublicKey("Hs7LzaMG6vrhfnHmJXhPx98uyYyEscdXT93dLKKxWQYF");
const SMM_TOKEN_MINT = new PublicKey("BbDK2SdFKstCuCjF152jWaRVmJMV7hHUW4xYvdMbjups");

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
  try {
    await fs.access(CLAIMS_FILE);
    console.log("Claims file exists");
  } catch {
    console.log("Creating new claims file");
    await fs.writeFile(CLAIMS_FILE, JSON.stringify({}));
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

// Load claims
async function loadClaims() {
  try {
    const data = await fs.readFile(CLAIMS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error loading claims:", err);
    return {};
  }
}

// Save claims
async function saveClaims(claims) {
  try {
    await fs.writeFile(CLAIMS_FILE, JSON.stringify(claims, null, 2));
    console.log("Saved claims to claims.json");
  } catch (err) {
    console.error("Error saving claims:", err);
  }
}

initFiles();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS
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

// Endpoint to view messages
app.get("/messages", async (req, res) => {
  try {
    const messages = await loadMessages();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Error reading messages" });
  }
});

// Endpoint to view users
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
    if (["dev", "admin", "owner"].includes(username.toLowerCase())) {
      console.log(`Invalid username attempt: ${username} for wallet ${wallet}`);
      return res.status(400).json({ error: "Username cannot be 'dev', 'admin', or 'owner'" });
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

// Endpoint to view suggestions
app.get("/suggestions", async (req, res) => {
  try {
    const { wallet } = req.query;
    if (!wallet) {
      console.log("Missing wallet in suggestions request");
      return res.status(400).json({ error: "Wallet address required" });
    }
    let userPublicKey;
    try {
      userPublicKey = new PublicKey(wallet);
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { wallet });
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const suggestions = await loadSuggestions();
    const isAdmin = wallet === ADMIN_WALLET.toBase58();
    const filteredSuggestions = isAdmin ? suggestions : suggestions.filter(s => s.wallet === wallet);
    console.log(`Returning ${filteredSuggestions.length} suggestions for wallet ${wallet} (isAdmin: ${isAdmin})`);
    res.json(filteredSuggestions);
  } catch (err) {
    console.error("Error reading suggestions:", err);
    res.status(500).json({ error: "Error reading suggestions" });
  }
});

// Endpoint for free suggestions
app.post("/submit-free-suggestion", async (req, res) => {
  try {
    const { wallet, suggestion } = req.body;
    console.log("Received /submit-free-suggestion request:", { wallet, suggestion });

    // Validate inputs
    if (!wallet || !suggestion) {
      console.log("Validation failed: Missing wallet or suggestion");
      return res.status(400).json({ error: "Wallet and suggestion required" });
    }

    // Validate wallet address
    let userPublicKey;
    try {
      userPublicKey = new PublicKey(wallet);
      console.log("Validated userPublicKey:", userPublicKey.toBase58());
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { wallet });
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const users = await loadUsers();
    const username = users[wallet] || wallet.slice(0, 6);
    const newSuggestion = { username, wallet, suggestion, timestamp: new Date().toISOString() };
    const suggestions = await loadSuggestions();
    suggestions.push(newSuggestion);
    await saveSuggestions(suggestions);

    console.log("Suggestion saved:", newSuggestion);
    res.json({ message: "Suggestion saved", suggestion: newSuggestion });
  } catch (err) {
    console.error("Error in /submit-free-suggestion:", err);
    res.status(500).json({ error: "Failed to save suggestion" });
  }
});

// Endpoint to delete suggestions
app.post("/delete-suggestion", async (req, res) => {
  try {
    const { index, wallet } = req.body;
    console.log("Received /delete-suggestion request:", { index, wallet });

    if (index === undefined || !wallet) {
      console.log("Validation failed: Missing index or wallet");
      return res.status(400).json({ error: "Index and wallet required" });
    }

    let userPublicKey;
    try {
      userPublicKey = new PublicKey(wallet);
      console.log("Validated userPublicKey:", userPublicKey.toBase58());
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { wallet });
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const isAdmin = wallet === ADMIN_WALLET.toBase58();
    const suggestions = await loadSuggestions();
    if (!suggestions[index]) {
      console.log(`No suggestion found at index ${index}`);
      return res.status(404).json({ error: "Suggestion not found" });
    }

    if (!isAdmin && suggestions[index].wallet !== wallet) {
      console.log(`Unauthorized deletion attempt by ${wallet} for suggestion at index ${index}`);
      return res.status(403).json({ error: "Unauthorized: You can only delete your own suggestions" });
    }

    console.log(`Deleting suggestion at index ${index} by ${isAdmin ? "admin" : "owner"} ${wallet}`);
    suggestions.splice(index, 1);
    await saveSuggestions(suggestions);
    res.json({ message: "Suggestion deleted" });
  } catch (err) {
    console.error("Error in /delete-suggestion:", err);
    res.status(500).json({ error: "Failed to delete suggestion" });
  }
});

// Endpoint to get rewards
app.get("/rewards/:walletAddress", async (req, res) => {
  try {
    const walletAddress = req.params.walletAddress;
    console.log("Fetching rewards for wallet:", walletAddress);
    let userPublicKey;
    try {
      userPublicKey = new PublicKey(walletAddress);
      console.log("Validated userPublicKey:", userPublicKey.toBase58());
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { walletAddress });
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const connection = await getConnection();
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      userPublicKey,
      { mint: SMM_TOKEN_MINT, programId: TOKEN_PROGRAM_ID }
    );
    let balance = 0;
    for (const { account } of tokenAccounts.value) {
      if (account.data.parsed.info.mint === SMM_TOKEN_MINT.toBase58()) {
        balance = parseFloat(account.data.parsed.info.tokenAmount.uiAmount);
        break;
      }
    }

    // Calculate daily reward: 10% annual return divided by 365
    const annualReward = balance * 0.10;
    const dailyReward = annualReward / 365;

    // Check if reward is claimable
    const claims = await loadClaims();
    const claimKey = walletAddress;
    const claimPeriod = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const lastClaim = claims[claimKey]?.timestamp || 0;
    const canClaim = now - lastClaim > claimPeriod;

    console.log(`Rewards for ${walletAddress}: balance=${balance}, dailyReward=${dailyReward}, canClaim=${canClaim}`);
    res.json({ balance, dailyReward, canClaim, lastClaim });
  } catch (err) {
    console.error("Error fetching rewards:", err);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

// Endpoint to claim reward
app.post("/claim-reward", async (req, res) => {
  try {
    const { walletAddress } = req.body;
    console.log("Received /claim-reward request:", { walletAddress });

    if (!walletAddress) {
      console.log("Validation failed: Missing walletAddress");
      return res.status(400).json({ error: "Wallet address required" });
    }

    let userPublicKey;
    try {
      userPublicKey = new PublicKey(walletAddress);
      console.log("Validated userPublicKey:", userPublicKey.toBase58());
    } catch (err) {
      console.error("Invalid wallet address:", err.message, { walletAddress });
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Check balance and calculate reward
    const connection = await getConnection();
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      userPublicKey,
      { mint: SMM_TOKEN_MINT, programId: TOKEN_PROGRAM_ID }
    );
    let balance = 0;
    for (const { account } of tokenAccounts.value) {
      if (account.data.parsed.info.mint === SMM_TOKEN_MINT.toBase58()) {
        balance = parseFloat(account.data.parsed.info.tokenAmount.uiAmount);
        break;
      }
    }
    const annualReward = balance * 0.10;
    const dailyReward = annualReward / 365;
    const rewardAmount = Math.floor(dailyReward * 1_000_000); // 6 decimals for $SMM

    // Check if reward is claimable
    const claims = await loadClaims();
    const claimKey = walletAddress;
    const claimPeriod = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    if (claims[claimKey] && (now - claims[claimKey].timestamp < claimPeriod)) {
      console.log(`Reward already claimed for wallet ${walletAddress}`);
      return res.status(400).json({ error: "Reward already claimed for this period" });
    }

    // Prepare transaction
    const userTokenAccount = await getAssociatedTokenAddressCustom(SMM_TOKEN_MINT, userPublicKey);
    const rewardTokenAccount = await getAssociatedTokenAddressCustom(SMM_TOKEN_MINT, donationWallet.publicKey);

    const transaction = new Transaction().add(
      createTransferInstruction(
        rewardTokenAccount,
        userTokenAccount,
        donationWallet.publicKey,
        rewardAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = donationWallet.publicKey;
    transaction.sign(donationWallet);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction(signature, "confirmed");
    console.log(`Reward claimed: ${rewardAmount / 1_000_000} SMM for wallet ${walletAddress}, signature: ${signature}`);

    // Update claims
    claims[claimKey] = { timestamp: now };
    await saveClaims(claims);

    res.json({ success: true, amount: rewardAmount / 1_000_000, signature });
  } catch (err) {
    console.error("Error in /claim-reward:", err);
    res.status(500).json({ error: "Failed to process claim" });
  }
});

// WebSocket handling
wss.on("connection", async (ws) => {
  console.log("New WebSocket connection established");
  ws.isAuthenticated = false;

  // Send existing messages to new client
  try {
    const messages = await loadMessages();
    messages.forEach((msg) => {
      if (msg.type === "chat" && msg.user && msg.rank && msg.text && msg.timestamp) {
        ws.send(JSON.stringify(msg));
      }
    });
    console.log("Sent existing messages to new client");
  } catch (err) {
    console.error("Error sending initial messages:", err);
  }

  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log("Received WebSocket message:", msg);

      if (!msg.type || !msg.user || !msg.rank || !msg.timestamp) {
        console.warn("Invalid message format:", msg);
        return;
      }

      if (msg.type === "chat") {
        if (!msg.text) {
          console.warn("Chat message missing text:", msg);
          return;
        }
        let userPublicKey;
        try {
          userPublicKey = new PublicKey(msg.originalWallet);
          console.log("Validated userPublicKey:", userPublicKey.toBase58());
        } catch (err) {
          console.error("Invalid user wallet in message:", err.message, { user: msg.originalWallet });
          return;
        }

        const connection = await getConnection();
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          userPublicKey,
          { mint: SMM_TOKEN_MINT, programId: TOKEN_PROGRAM_ID }
        );
        let tokenBalance = 0;
        for (const { account } of tokenAccounts.value) {
          if (account.data.parsed.info.mint === SMM_TOKEN_MINT.toBase58()) {
            tokenBalance = parseFloat(account.data.parsed.info.tokenAmount.uiAmount);
            break;
          }
        }

        const rank = tokenBalance >= 1000000 ? "Rhodium" :
                     tokenBalance >= 750000 ? "Platinum" :
                     tokenBalance >= 500000 ? "Gold" :
                     tokenBalance >= 250000 ? "Silver" :
                     tokenBalance >= 100000 ? "Bronze" : "No Rank";

        if (msg.rank !== rank) {
          console.warn(`Rank mismatch: provided ${msg.rank}, calculated ${rank} for wallet ${msg.originalWallet}`);
          return;
        }

        const messages = await loadMessages();
        messages.push({ ...msg });
        await saveMessages(messages);
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
            client.send(JSON.stringify(msg));
          }
        });
        console.log(`Broadcasted chat message: ${msg.rank} ${msg.user}: ${msg.text}`);
      } else if (msg.type === "delete") {
        try {
          if (msg.index === undefined || !msg.wallet) {
            console.warn("Invalid delete message:", msg);
            return;
          }
          let userPublicKey;
          try {
            userPublicKey = new PublicKey(msg.wallet);
            console.log("Validated userPublicKey for delete:", userPublicKey.toBase58());
          } catch (err) {
            console.error("Invalid wallet in delete message:", err.message, { wallet: msg.wallet });
            return;
          }

          const messages = await loadMessages();
          const isAdmin = msg.wallet === ADMIN_WALLET.toBase58();
          if (!messages[msg.index]) {
            console.log(`No message found at index ${msg.index}`);
            return;
          }
          if (!isAdmin && messages[msg.index].originalWallet !== msg.wallet) {
            console.log(`Unauthorized delete attempt by ${msg.wallet} for message at index ${msg.index}`);
            return;
          }
          console.log(`Deleting message at index ${msg.index} by ${isAdmin ? "admin" : "owner"} ${msg.wallet}`);
          messages.splice(msg.index, 1);
          await saveMessages(messages);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
              client.send(JSON.stringify({ type: "delete", index: msg.index }));
            }
          });
          console.log(`Deleted message at index ${msg.index}`);
        } catch (err) {
          console.error("Error processing delete message:", err);
        }
      } else {
        console.warn("Unknown message type:", msg.type);
      }
    } catch (err) {
      console.error("Error processing WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });

  ws.isAuthenticated = true;
});

// Start server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});