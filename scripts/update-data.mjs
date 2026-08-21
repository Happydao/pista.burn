import fs from "node:fs";
import path from "node:path";

const BURNER = "5G62fW1BuK6k9B6sGwvTBtoKRPseshj9SSYPzudSPUYE";
const MINT = "9CaQUthsVMugZzMvskrrvcHXyjFqHGdNtGkPT8QSRACE";
const API_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = process.env.SOLANA_RPC_URL || (API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${API_KEY}` : null);
const DATA_PATH = path.join(process.cwd(), "data", "dashboard.json");
const LIMIT = 100;
const INITIAL_MAX_PAGES = 20;
const UPDATE_MAX_PAGES = 5;

if (!RPC_URL) throw new Error("HELIUS_API_KEY is required (or set SOLANA_RPC_URL for local testing).");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (response.status === 429 || response.status >= 500) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError || new Error(`${method} failed`);
}

async function signatureBatch({ before = null, until = null, maxPages }) {
  const signatures = [];
  let pageBefore = before;
  let exhausted = false;
  for (let page = 0; page < maxPages; page += 1) {
    const options = { limit: LIMIT };
    if (pageBefore) options.before = pageBefore;
    if (until) options.until = until;
    const batch = await rpc("getSignaturesForAddress", [BURNER, options]);
    if (!batch?.length) { exhausted = true; break; }
    signatures.push(...batch.filter((item) => item.err === null));
    pageBefore = batch.at(-1).signature;
    if (batch.length < LIMIT) { exhausted = true; break; }
  }
  return { signatures, exhausted, oldest: pageBefore };
}

function accountPubkey(account) {
  return typeof account === "string" ? account : account?.pubkey;
}

function normalizeRaw(raw, fromDecimals, toDecimals) {
  if (fromDecimals === toDecimals) return raw;
  return fromDecimals < toDecimals
    ? raw * 10n ** BigInt(toDecimals - fromDecimals)
    : raw / 10n ** BigInt(fromDecimals - toDecimals);
}

function findBurns(tx, decimals) {
  const keys = tx?.transaction?.message?.accountKeys?.map(accountPubkey) || [];
  const mintByAccount = new Map();
  for (const balance of [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])]) {
    if (keys[balance.accountIndex]) mintByAccount.set(keys[balance.accountIndex], balance.mint);
  }

  const events = [];
  let instructionIndex = 0;
  const scan = (instructions) => {
    for (const instruction of instructions || []) {
      const parsed = instruction?.parsed;
      const currentIndex = instructionIndex++;
      if (!parsed || !["burn", "burnChecked"].includes(parsed.type)) continue;
      const info = parsed.info || {};
      const resolvedMint = info.mint || mintByAccount.get(info.account);
      if (resolvedMint !== MINT) continue;
      const rawValue = info.tokenAmount?.amount ?? info.amount;
      if (rawValue === undefined) continue;
      const sourceDecimals = Number(info.tokenAmount?.decimals ?? decimals);
      events.push({ raw: normalizeRaw(BigInt(String(rawValue)), sourceDecimals, decimals), instructionIndex: currentIndex });
    }
  };
  scan(tx?.transaction?.message?.instructions);
  for (const inner of tx?.meta?.innerInstructions || []) scan(inner.instructions);
  return events;
}

function decimalString(raw, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function getPrice() {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json();
    const pairs = (payload.pairs || []).filter((pair) => pair.chainId === "solana" && Number(pair.priceUsd) > 0);
    pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
    return pairs[0] ? Number(pairs[0].priceUsd) : null;
  } catch {
    return null;
  }
}

function readExisting() {
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function writeAtomic(data) {
  const temporary = `${DATA_PATH}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, DATA_PATH);
}

async function main() {
  const existing = readExisting();
  const supplyResult = await rpc("getTokenSupply", [MINT, { commitment: "confirmed" }]);
  const decimals = Number(supplyResult.value.decimals);
  const currentSupplyRaw = BigInt(supplyResult.value.amount);
  const known = new Map((existing.burns || []).map((burn) => [burn.id, burn]));
  const scanState = { cursor: existing.scan?.cursor || null, backfillBefore: existing.scan?.backfillBefore || null, complete: Boolean(existing.scan?.complete) };
  let signatures = [];

  if (!scanState.cursor) {
    const initial = await signatureBatch({ maxPages: INITIAL_MAX_PAGES });
    signatures = initial.signatures;
    scanState.cursor = initial.signatures[0]?.signature || null;
    scanState.backfillBefore = initial.oldest;
    scanState.complete = initial.exhausted;
  } else {
    const recent = await signatureBatch({ until: scanState.cursor, maxPages: UPDATE_MAX_PAGES });
    if (!recent.exhausted && recent.signatures.length >= LIMIT * UPDATE_MAX_PAGES) {
      throw new Error("More than 500 new wallet transactions found; refusing to skip history.");
    }
    signatures.push(...recent.signatures);
    if (recent.signatures.length) scanState.cursor = recent.signatures[0].signature;
    if (!scanState.complete && scanState.backfillBefore) {
      const older = await signatureBatch({ before: scanState.backfillBefore, maxPages: UPDATE_MAX_PAGES });
      signatures.push(...older.signatures);
      scanState.backfillBefore = older.oldest;
      scanState.complete = older.exhausted;
    }
  }

  const uniqueSignatures = [...new Map(signatures.map((item) => [item.signature, item])).values()];
  console.log(`Inspecting ${uniqueSignatures.length} wallet transaction(s)…`);
  for (const item of uniqueSignatures) {
    const transaction = await rpc("getTransaction", [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    if (!transaction) continue;
    for (const burn of findBurns(transaction, decimals)) {
      const id = `${item.signature}:${burn.instructionIndex}`;
      known.set(id, {
        id,
        signature: item.signature,
        amountRaw: burn.raw.toString(),
        amount: decimalString(burn.raw, decimals),
        timestamp: Number.isFinite(transaction.blockTime) ? new Date(transaction.blockTime * 1000).toISOString() : null,
        slot: item.slot,
        url: `https://solscan.io/tx/${item.signature}`,
      });
    }
    await sleep(80);
  }

  const burns = [...known.values()].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const totalRaw = burns.reduce((sum, burn) => sum + BigInt(burn.amountRaw), 0n);
  const totalBurned = decimalString(totalRaw, decimals);
  const currentSupply = decimalString(currentSupplyRaw, decimals);
  const preBurnRaw = currentSupplyRaw + totalRaw;
  const preBurnSupply = decimalString(preBurnRaw, decimals);
  const burnedPercent = preBurnRaw > 0n ? Number((totalRaw * 1_000_000n) / preBurnRaw) / 10_000 : 0;
  const priceUsd = await getPrice();

  const output = {
    schemaVersion: 1,
    token: { name: "PISTA", symbol: "PISTA", mint: MINT, decimals },
    burner: BURNER,
    updatedAt: new Date().toISOString(),
    scan: scanState,
    stats: {
      burnCount: burns.length,
      totalBurned,
      currentSupply,
      preBurnSupply,
      burnedPercent,
      priceUsd,
      burnedValueUsd: priceUsd ? Number(totalBurned) * priceUsd : null,
    },
    burns,
  };
  writeAtomic(output);
  console.log(`Saved ${burns.length} verified PISTA burn(s), total ${totalBurned} PISTA.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
