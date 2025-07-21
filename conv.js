const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const base58PrivateKey = "5eafV26b2TzRRc88WbdnGK3wbNwB352hNMwgKRLFgcgi39Fedv1Xpr889Co6Wy4HYKVo4aPLUthK85Db9Voy2DLb"; // Your base58 key

try {
  const privateKeyBytes = bs58.decode(base58PrivateKey);

  // Optional: Log the raw byte length
  console.log("Decoded byte length:", privateKeyBytes.length);

  // If the decoded key is 64 bytes, it's a full keypair secret
  const keypair = Keypair.fromSecretKey(privateKeyBytes);

  console.log("✅ Derived Public Key:", keypair.publicKey.toBase58());
  console.log("📦 JSON Array for .env:");
  console.log(JSON.stringify(Array.from(privateKeyBytes)));
} catch (err) {
  console.error("❌ Failed to decode or construct Keypair:");
  console.error(err.message);
}