const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const VryfdABI = require("../abis/VryfdAttendance.json");
const VRYFTokenABI = require("../abis/VRYFToken.json");
const { getENSOverride } = require("./ensOverrides");

// ─── Sleep helper — used to throttle RPC calls and avoid Alchemy 429s ────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Atomic JSON write helper ─────────────────────────────────────────────────
// Writes JSON to a .tmp file then renames it over the target so readers never
// see a partially-written file (important on Windows where rename is also atomic).
function atomicWriteJSON(filePath, data) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// ─── Hardcoded join codes by demoId — survives Railway redeployments ─────────
// These match INITIAL_EVENTS in the frontend. Used as fallback when the
// onChainId-based customCodeStore is empty (e.g. after ephemeral filesystem wipe).
const DEMO_JOIN_CODES = {
  "1": "HK7P2T",
  "2": "W5NX4M",
  "3": "B9ZR6Q",
  "4": "Y3VJ8F",
};

// ─── Join code store: codes set at event creation, persisted to disk ─────────
const customCodeStore = new Map(); // onChainEventId (string) → code (uppercase)

function setCustomCode(onChainEventId, code) {
  customCodeStore.set(String(onChainEventId), code.toUpperCase().trim());
}

// ─── Event meta cache: populated at deploy time, avoids RPC calls during check-in ───
// onChainEventId (string) → { startTime: number, endTime: number }
const eventMetaCache = new Map();

function setEventMeta(onChainEventId, startTime, endTime) {
  eventMetaCache.set(String(onChainEventId), { startTime: Number(startTime), endTime: Number(endTime) });
}

function getJoinCode(onChainEventId) {
  const code = customCodeStore.get(String(onChainEventId));
  if (!code) throw new Error("No join code registered for this event");
  return code;
}

// Alias for backwards compatibility with existing callers
function generateJoinCode(onChainEventId) {
  return getJoinCode(onChainEventId);
}

// ─── Pending attendees store: onChainEventId → Map<attendee.lower, { attendee, signature }> ─
// Attendees who entered the correct join code but whose attendance has not
// yet been confirmed on-chain by the organizer. Signature is stored so the
// relayer can call confirmAttendanceGasless on behalf of the attendee.
const pendingStore = new Map();
const PENDING_STORE_PATH = path.join(__dirname, "../../data/pending.json");

function savePendingStore() {
  try {
    const obj = {};
    for (const [eventId, m] of pendingStore) {
      obj[eventId] = [...m.values()];
    }
    atomicWriteJSON(PENDING_STORE_PATH, obj);
  } catch (e) {
    console.error("[pending store] save failed:", e.message);
  }
}

function loadPendingStore() {
  try {
    const obj = JSON.parse(fs.readFileSync(PENDING_STORE_PATH, "utf8"));
    for (const [eventId, entries] of Object.entries(obj)) {
      const m = new Map();
      for (const entry of entries) {
        m.set(entry.attendee.toLowerCase(), entry);
      }
      pendingStore.set(eventId, m);
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[pending store] load failed:", e.message);
  }
}

function addPending(onChainEventId, attendee, signature, ens = null) {
  const key = String(onChainEventId);
  const addr = attendee.toLowerCase(); // normalise once — used as both Map key and stored value
  if (!pendingStore.has(key)) pendingStore.set(key, new Map());
  pendingStore.get(key).set(addr, { attendee: addr, signature, ens: ens || null });
  savePendingStore();
}

function isPending(onChainEventId, attendee) {
  return pendingStore.get(String(onChainEventId))?.has(attendee.toLowerCase()) ?? false;
}

function removePending(onChainEventId, attendee) {
  pendingStore.get(String(onChainEventId))?.delete(attendee.toLowerCase());
  savePendingStore();
}

function getPendingAttendees(onChainEventId) {
  const m = pendingStore.get(String(onChainEventId));
  if (!m) return [];
  return [...m.values()].map((v) => ({ attendee: v.attendee, ens: v.ens || null }));
}

function getPendingEntry(onChainEventId, attendee) {
  return pendingStore.get(String(onChainEventId))?.get(attendee.toLowerCase());
}

// Join code → pending registration (organizer confirms later via checkInFor — no sig needed on-chain)
function joinCodeCheckin(onChainEventId, attendee, code, signature, ens = null, demoId = null) {
  // 1. Verify code — use customCodeStore if available, else fall back to DEMO_JOIN_CODES by demoId
  let expected;
  const stored = customCodeStore.get(String(onChainEventId));
  if (stored) {
    expected = stored;
  } else if (demoId && DEMO_JOIN_CODES[String(demoId)]) {
    expected = DEMO_JOIN_CODES[String(demoId)];
    console.log(`[joinCodeCheckin] using DEMO_JOIN_CODES fallback for demoId=${demoId}`);
  } else {
    throw new Error("No join code registered for this event");
  }
  if (code.toUpperCase().trim() !== expected) throw new Error("Incorrect join code");

  // 2. Verify personal_sign signature — proves the request came from the attendee's wallet.
  //    Uses eth_sign / personal_sign (not EIP-712) to avoid domain-separator mismatches
  //    caused by contract address drift after resets. Anti-replay is handled by the
  //    pending-queue dedup below (isPending) and the on-chain confirmed check above.
  {
    const message = `VRYFD check-in\nEvent: ${onChainEventId}\nAttendee: ${attendee}`;
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== attendee.toLowerCase())
      throw new Error(`Signature does not match: expected ${attendee} got ${recovered}`);
  }

  // 2. Already confirmed? — use in-memory store (no RPC needed)
  if (confirmedAttendeesStore.get(String(onChainEventId))?.has(attendee.toLowerCase())) {
    throw new Error("Already confirmed on-chain");
  }

  // 3. Event time window — use cached metadata if available (set at deploy time)
  const meta = eventMetaCache.get(String(onChainEventId));
  if (meta) {
    const now = Math.floor(Date.now() / 1000);
    if (now < meta.startTime) throw new Error("Event has not started yet");
    if (now > meta.endTime) throw new Error("Event has ended");
  }
  // No meta cached (e.g. pre-seeded INITIAL_DEPLOYED_EVENTS) — skip time check, join code is sufficient auth

  // 4. Already in pending queue?
  if (isPending(onChainEventId, attendee)) {
    throw new Error("Already registered — awaiting organizer confirmation");
  }

  // 5. Add to pending — organizer calls checkInFor on their behalf
  addPending(onChainEventId, attendee, signature, ens);
  return { pending: true };
}

// Organizer confirms a single pending attendee → calls checkInFor (ORGANIZER_ROLE, no user sig needed).
// Using checkInFor instead of confirmAttendanceGasless avoids EIP-712 nonce/domain issues entirely:
// the join code itself proved user intent; the organizer just writes the attendance on their behalf.
// ─── Confirmed attendee counter (per onChainEventId) ─────────────────────────
// In-memory count, persisted to deployedEvents.json under "confirmedCount" key.
const confirmedCountStore = new Map(); // onChainEventId (string) → number

// ─── Confirmed attendee list (per onChainEventId) ─────────────────────────────
// Tracks which addresses have been confirmed so issueCertificatesBulk can use
// this instead of doing a slow paginated log scan from deploy block.
const confirmedAttendeesStore = new Map(); // onChainEventId (string) → Set<address.lower>

// Full attendee detail cache: onChainEventId (string) → Map<address.lower, {attendee, timestamp, txHash}>
const confirmedAttendeesDetailStore = new Map();

function getConfirmedAttendees(onChainEventId) {
  return [...(confirmedAttendeesStore.get(String(onChainEventId)) ?? new Set())];
}

function getConfirmedAttendeesDetail(onChainEventId) {
  const details = confirmedAttendeesDetailStore.get(String(onChainEventId));
  if (!details) return null; // null = not cached, caller should fall back to chain scan
  return [...details.values()];
}

function addConfirmedAttendeeDetail(onChainEventId, attendee, timestamp, txHash) {
  const key = String(onChainEventId);
  if (!confirmedAttendeesDetailStore.has(key)) confirmedAttendeesDetailStore.set(key, new Map());
  confirmedAttendeesDetailStore.get(key).set(attendee.toLowerCase(), { attendee, timestamp, txHash });
}

function getConfirmedCount(onChainEventId) {
  const key = String(onChainEventId);
  // Prefer explicit count store; fall back to address-set size so the two never diverge
  return confirmedCountStore.get(key)
    ?? confirmedAttendeesStore.get(key)?.size
    ?? confirmedAttendeesDetailStore.get(key)?.size
    ?? 0;
}

function incrementConfirmedCount(onChainEventId, attendee) {
  const key = String(onChainEventId);
  const next = (confirmedCountStore.get(key) ?? 0) + 1;
  confirmedCountStore.set(key, next);

  // Track attendee address
  if (attendee) {
    if (!confirmedAttendeesStore.has(key)) confirmedAttendeesStore.set(key, new Set());
    confirmedAttendeesStore.get(key).add(attendee.toLowerCase());
  }

  // Persist to deployedEvents.json
  try {
    const store = loadDeployedEvents();
    for (const info of Object.values(store)) {
      if (String(info.onChainId) === key) {
        info.confirmedCount = next;
        // Persist attendee list as array
        const list = [...(confirmedAttendeesStore.get(key) ?? [])];
        info.confirmedAttendees = list;
        // Persist full attendee details for fast reload after server restart
        const details = confirmedAttendeesDetailStore.get(key);
        info.confirmedAttendeesDetail = details ? [...details.values()] : [];
      }
    }
    atomicWriteJSON(STORE_PATH, store);
  } catch (e) {
    console.error("[store] incrementConfirmedCount persist failed:", e.message);
  }
}

async function confirmAttendee(onChainEventId, attendee) {
  return withRpcFallback(async () => {
    const c = getContract();

    // Submit the tx — if the contract reverts (already checked in), catch it here
    let tx;
    try {
      tx = await c.checkInFor(attendee, BigInt(onChainEventId));
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("checked in") || msg.includes("confirmed")) {
        removePending(onChainEventId, attendee);
        return { alreadyConfirmed: true, txHash: null };
      }
      throw err;
    }

    const txHash = tx.hash;

    // Remove from pending immediately so the organizer UI updates right away
    removePending(onChainEventId, attendee);

    // Seed the detail cache optimistically so the attendee count increments now
    // (doesn't wait for block confirmation — receipt.hash === txHash on Sepolia)
    const timestamp = Math.floor(Date.now() / 1000);
    addConfirmedAttendeeDetail(onChainEventId, attendee, timestamp, txHash);
    incrementConfirmedCount(onChainEventId, attendee);

    // Wait for receipt in background — no need to block the HTTP response
    tx.wait(1, 120_000).catch((err) => {
      console.warn(`[confirmAttendee] tx ${txHash} wait failed:`, err.message);
    });

    return { txHash };
  });
}

// Organizer confirms all pending attendees for an event at once.
// Submits all checkInFor txs with sequential explicit nonces so they land in the
// mempool without waiting for each block. Same nonce-management pattern as issueCertificatesBulk.
async function confirmAllAttendees(onChainEventId) {
  const pending = getPendingAttendees(onChainEventId); // returns { attendee, ens }[]
  if (pending.length === 0) return [];

  const results = [];

  // Get starting nonce once before the loop — never inside a retry lambda
  let nonce;
  try {
    nonce = await provider.getTransactionCount(relayerWallet.address, "pending");
  } catch (err) {
    console.warn("[confirmAllAttendees] could not get nonce, falling back to sequential:", err.message);
    for (const { attendee } of pending) {
      try {
        const result = await confirmAttendee(onChainEventId, attendee);
        results.push({ attendee, status: result.alreadyConfirmed ? "already_confirmed" : "confirmed", txHash: result.txHash });
      } catch (e) {
        results.push({ attendee, status: "failed", reason: e.message });
      }
    }
    return results;
  }

  for (const { attendee } of pending) {
    const txNonce = nonce;
    try {
      const c = getContract();
      let tx;
      try {
        tx = await withRpcFallback(() => c.checkInFor(attendee, BigInt(onChainEventId), { nonce: txNonce }));
      } catch (err) {
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("already") || msg.includes("checked in") || msg.includes("confirmed")) {
          removePending(onChainEventId, attendee);
          results.push({ attendee, status: "already_confirmed", txHash: null });
          continue; // tx was rejected — nonce was NOT consumed, don't increment
        }
        throw err;
      }

      nonce++; // increment only after successful submission
      const txHash = tx.hash;
      console.log(`[confirmAllAttendees] submitted tx=${txHash} nonce=${txNonce} attendee=${attendee}`);

      removePending(onChainEventId, attendee);
      const timestamp = Math.floor(Date.now() / 1000);
      addConfirmedAttendeeDetail(onChainEventId, attendee, timestamp, txHash);
      incrementConfirmedCount(onChainEventId, attendee);

      // Wait for receipt in background — don't block the submission loop
      tx.wait(1, 120_000).catch((e) => {
        console.warn(`[confirmAllAttendees] tx ${txHash} wait failed:`, e.message);
      });

      results.push({ attendee, status: "confirmed", txHash });
    } catch (err) {
      console.error(`[confirmAllAttendees] submit failed attendee=${attendee} nonce=${txNonce}:`, err.message);
      results.push({ attendee, status: "failed", reason: err.message });
      // tx was NOT submitted — nonce unchanged, no increment
    }
  }

  return results;
}

// ─── Persistent event store (backend/data/deployedEvents.json) ────────────
const STORE_PATH = path.join(__dirname, "../../data/deployedEvents.json");
const EVENTS_STORE_PATH = path.join(__dirname, "../../data/events.json");

// Full event list persistence — source of truth for all frontend events
function getAllEvents() {
  try {
    const raw = fs.readFileSync(EVENTS_STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

function saveAllEvents(events) {
  atomicWriteJSON(EVENTS_STORE_PATH, events);
}

// Default state: events 1 & 2 are pre-deployed on Sepolia (always live).
// These values must match the actual on-chain IDs in deployedEvents.json.
// Run: node -e "console.log(require('./data/deployedEvents.json'))" to verify.
const INITIAL_DEPLOYED_EVENTS = {
  "1": { txHash: "0xf235ead355af6b55ea855f1cb56882480d90d4f7681a792211ea5915ab415524", onChainId: "15", joinCode: "HK7P2T" },
  "2": { txHash: "0x0757989ad76ca232eb664bba986a365bf099cf2e1e80d0fd884efdb5d0ef2289", onChainId: "16", joinCode: "W5NX4M" },
};

function loadDeployedEvents() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); } catch { return {}; }
}

function saveDeployedEvent(demoId, txHash, onChainId, joinCode, startTime = null, endTime = null) {
  const store = loadDeployedEvents();
  store[String(demoId)] = {
    txHash,
    onChainId,
    ...(joinCode ? { joinCode } : {}),
    ...(startTime != null ? { startTime: Number(startTime) } : {}),
    ...(endTime != null ? { endTime: Number(endTime) } : {}),
  };
  atomicWriteJSON(STORE_PATH, store);
}

function getDeployedEvents() {
  return loadDeployedEvents();
}

// Reset deployed events to the initial state (events 1 & 2 only)
// and clear all in-memory pending registrations and custom codes.
// Reads the current deployedEvents.json to build the reset baseline so the
// onChainIds stay in sync with the actual contract even after redeployments.
function clearAllDeployedEvents() {
  // Fully wipe all deployed event state — used after new contract deployment
  // so stale join codes / on-chain IDs from the old contract don't bleed through.
  fs.writeFileSync(STORE_PATH, JSON.stringify({}, null, 2));
  try { fs.unlinkSync(path.join(__dirname, "../../data/contractState.json")); } catch {}
  customCodeStore.clear();
  pendingStore.clear();
  savePendingStore();
  confirmedCountStore.clear();
  confirmedAttendeesStore.clear();
  confirmedAttendeesDetailStore.clear();
  try { fs.unlinkSync(EVENTS_STORE_PATH); } catch {}
}

function resetDeployedEvents() {
  // Build reset state: keep only events 1 & 2, strip confirmedCount/attendees
  const current = loadDeployedEvents();
  const resetState = {};
  for (const [demoId, info] of Object.entries(current)) {
    if (demoId === "1" || demoId === "2") {
      resetState[demoId] = { txHash: info.txHash, onChainId: info.onChainId, joinCode: info.joinCode };
    }
  }
  // Fallback to INITIAL_DEPLOYED_EVENTS only if current file is empty/missing entries
  if (!resetState["1"] || !resetState["2"]) {
    Object.assign(resetState, INITIAL_DEPLOYED_EVENTS);
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(resetState, null, 2));
  customCodeStore.clear();
  for (const info of Object.values(resetState)) {
    if (info.joinCode && info.onChainId !== undefined && info.onChainId !== null) {
      customCodeStore.set(String(info.onChainId), info.joinCode.toUpperCase());
    }
  }
  pendingStore.clear();
  savePendingStore();
  confirmedCountStore.clear();
  confirmedAttendeesStore.clear();
  confirmedAttendeesDetailStore.clear();
  // Also clear the full events store so the page reloads to the initial state
  try { fs.unlinkSync(EVENTS_STORE_PATH); } catch {}
}

// Load custom codes from persisted store on startup — survives server restarts.
// Falls back to INITIAL_DEPLOYED_EVENTS when deployedEvents.json has no join codes
// (e.g., Railway cold start where the ephemeral filesystem is empty).
function loadCustomCodesFromStore() {
  const store = loadDeployedEvents();
  for (const info of Object.values(store)) {
    if (info.joinCode && info.onChainId !== undefined && info.onChainId !== null) {
      customCodeStore.set(String(info.onChainId), info.joinCode.toUpperCase());
    }
    if (info.startTime != null && info.endTime != null && info.onChainId !== undefined && info.onChainId !== null) {
      eventMetaCache.set(String(info.onChainId), { startTime: Number(info.startTime), endTime: Number(info.endTime) });
    }
    if (info.confirmedCount && info.onChainId !== undefined && info.onChainId !== null) {
      confirmedCountStore.set(String(info.onChainId), info.confirmedCount);
    }
    if (Array.isArray(info.confirmedAttendees) && info.confirmedAttendees.length > 0 && info.onChainId !== undefined && info.onChainId !== null) {
      confirmedAttendeesStore.set(String(info.onChainId), new Set(info.confirmedAttendees));
    }
    if (Array.isArray(info.confirmedAttendeesDetail) && info.confirmedAttendeesDetail.length > 0 && info.onChainId !== undefined && info.onChainId !== null) {
      const key = String(info.onChainId);
      const detailMap = new Map();
      for (const d of info.confirmedAttendeesDetail) {
        detailMap.set(d.attendee.toLowerCase(), d);
      }
      confirmedAttendeesDetailStore.set(key, detailMap);
    }
  }
  // If no join codes were loaded from disk (e.g., Railway ephemeral filesystem on cold start),
  // seed from INITIAL_DEPLOYED_EVENTS so check-in always works without manual redeploy.
  if (customCodeStore.size === 0) {
    for (const info of Object.values(INITIAL_DEPLOYED_EVENTS)) {
      if (info.joinCode && info.onChainId !== undefined && info.onChainId !== null) {
        customCodeStore.set(String(info.onChainId), info.joinCode.toUpperCase());
      }
    }
  }
  loadPendingStore();
  // Remove pending entries that are already confirmed — avoids stale entries after restart
  let pendingChanged = false;
  for (const [eventId, m] of pendingStore) {
    const confirmedAddrs = confirmedAttendeesStore.get(eventId);
    const confirmedDetails = confirmedAttendeesDetailStore.get(eventId);
    for (const addr of [...m.keys()]) {
      const inAddrStore = confirmedAddrs?.has(addr);
      const inDetailStore = confirmedDetails?.has(addr);
      if (inAddrStore || inDetailStore) { m.delete(addr); pendingChanged = true; }
    }
  }
  if (pendingChanged) savePendingStore();
}

// RPC URL list: Alchemy first (if configured), then public fallbacks.
// ethers v6 FallbackProvider doesn't retry on 429 (treats it as valid error, not network fail),
// so we manage fallback manually via switchToFallbackRpc().
let rpcUrls = [];
let rpcIndex = 0;
let provider;
let relayerWallet;
let contract;
let cachedChainId = null;


const SEPOLIA_NETWORK = ethers.Network.from({ name: "sepolia", chainId: 11155111 });

function buildProviderForUrl(url) {
  // staticNetwork: true tells ethers not to call eth_chainId on every request.
  // Hard-coding Sepolia avoids ~2 extra RPC round-trips per call on Alchemy free tier.
  const p = new ethers.JsonRpcProvider(url, SEPOLIA_NETWORK, { staticNetwork: true });
  // Poll every 1s instead of the 4s default — detects block confirmations up to 3s sooner.
  // 1 eth_blockNumber call/s = 10 CU/s, well within Alchemy free tier (330 CU/s).
  p.pollingInterval = 1_000;
  // Override fee data: higher priority tip = validators include the tx in the next block.
  // maxFeePerGas caps total spend; maxPriorityFeePerGas is the validator tip.
  const _getFeeData = p.getFeeData.bind(p);
  p.getFeeData = async () => {
    const base = await _getFeeData();
    const wantedTip = ethers.parseUnits("5", "gwei");
    const baseMax = base.maxFeePerGas ?? ethers.parseUnits("50", "gwei");
    // maxFeePerGas must be >= maxPriorityFeePerGas — if Sepolia base fee is very low
    // the provider's maxFeePerGas can be less than our 5 gwei tip, causing a BAD_DATA error.
    const safeMax = baseMax < wantedTip ? wantedTip * 2n : baseMax;
    return {
      gasPrice: base.gasPrice,
      maxFeePerGas: safeMax,
      maxPriorityFeePerGas: wantedTip,
    };
  };
  return p;
}

async function getChainId() {
  if (cachedChainId) return cachedChainId;
  const network = await provider.getNetwork();
  cachedChainId = Number(network.chainId);
  return cachedChainId;
}

function switchToFallbackRpc(reason) {
  const nextIndex = (rpcIndex + 1) % rpcUrls.length;
  // Don't wrap around back to the same RPC we just failed on
  if (nextIndex === 0 && rpcUrls.length === 1) {
    console.warn(`[RPC] ${reason} — only one RPC configured, cannot fallback`);
    return false;
  }
  rpcIndex = nextIndex;
  const nextUrl = rpcUrls[rpcIndex];
  console.warn(`[RPC] ${reason} — switching to RPC #${rpcIndex}: ${nextUrl}`);
  provider = buildProviderForUrl(nextUrl);
  relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  // Use current contract address (not env var) so RPC failover after a reset stays on the new contract
  const currentContractAddress = contract ? contract.target : process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  contract = new ethers.Contract(currentContractAddress, VryfdABI.abi, relayerWallet);
  return true;
}

function isRateLimitError(err) {
  // Check top-level code
  if (err?.code === 429) return true;
  // Check nested Alchemy error payload (ethers v6 puts it in err.error or err.info.error)
  if (err?.error?.code === 429) return true;
  if (err?.info?.error?.code === 429) return true;
  // Fallback: stringify and scan for the pattern or message text
  try {
    const s = JSON.stringify(err);
    if (s.includes('"code":429') || s.includes('"code": 429') || s.includes('compute units')) return true;
  } catch {}
  // eth_call throttled — Alchemy returns empty response, ethers throws CALL_EXCEPTION data=null
  if (err?.code === "CALL_EXCEPTION" && err?.data === null) return true;
  return false;
}

async function withRpcFallback(fn) {
  // Loop through ALL available RPCs until one succeeds or we run out.
  // A single retry isn't enough when multiple providers are throttled simultaneously.
  let lastErr;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;               // not a rate limit — bail immediately
      if (!switchToFallbackRpc("RPC rate limit / 429")) throw err; // no more fallbacks left
      // switched to next RPC — loop and retry
    }
  }
}

/**
 * Deploy fresh VRYFToken + VryfdAttendance contracts and rewire the relayer.
 * Called on reset so every test cycle starts with a clean chain state.
 */
async function deployContracts() {
  if (!relayerWallet) throw new Error("Relayer not initialized — cannot deploy");

  // Get nonce once — all 3 txs are submitted with explicit sequential nonces so
  // they land in the same block instead of 3 separate blocks (~12s vs ~45s).
  const nonce = await provider.getTransactionCount(relayerWallet.address, "pending");

  // Pre-compute both contract addresses deterministically (deployer + nonce)
  // so VryfdAttendance and grantRole can be submitted without waiting for prior txs.
  const vryfAddress       = ethers.getCreateAddress({ from: relayerWallet.address, nonce });
  const attendanceAddress = ethers.getCreateAddress({ from: relayerWallet.address, nonce: nonce + 1 });
  // MINTER_ROLE = keccak256("MINTER_ROLE") — hardcoded to avoid an extra RPC call
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  console.log(`[deploy] Submitting all 3 txs in parallel (nonces ${nonce}-${nonce + 2})...`);

  const vryfFactory       = new ethers.ContractFactory(VRYFTokenABI.abi, VRYFTokenABI.bytecode, relayerWallet);
  const attendanceFactory = new ethers.ContractFactory(VryfdABI.abi, VryfdABI.bytecode, relayerWallet);

  // Submit all 3 transactions simultaneously
  const [vryfToken, attendance, grantTx] = await Promise.all([
    vryfFactory.deploy({ nonce }),
    attendanceFactory.deploy("ipfs://", vryfAddress, { nonce: nonce + 1 }),
    relayerWallet.sendTransaction({
      to: vryfAddress,
      data: new ethers.Interface(VRYFTokenABI.abi).encodeFunctionData("grantRole", [MINTER_ROLE, attendanceAddress]),
      nonce: nonce + 2,
      gasLimit: 150_000n, // explicit limit: gas estimation targets an empty address before deploy, would underestimate
    }),
  ]);

  // Wait for all 3 confirmations in parallel — same block, so this resolves together
  await Promise.all([
    vryfToken.waitForDeployment(),
    attendance.waitForDeployment(),
    grantTx.wait(1, 120_000),
  ]);

  console.log(`[deploy] VRYFToken: ${vryfAddress}`);
  console.log(`[deploy] VryfdAttendance: ${attendanceAddress}`);
  console.log("[deploy] MINTER_ROLE granted — all done in one block");

  // Rewire the relayer to point at new contracts
  contract = new ethers.Contract(attendanceAddress, VryfdABI.abi, relayerWallet);

  // Submit milestone URI txs immediately with explicit sequential nonces (nonce+3,+4,+5).
  // This prevents nonce collisions with createEvent calls that arrive right after the
  // frontend reloads — without explicit nonces both callers would get the same pending count.
  const baseUrl = process.env.BACKEND_URL ||
    (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : null);
  if (baseUrl) {
    try {
      const milestoneNonce = nonce + 3;
      const thresholds = [5, 10, 20];
      const milestoneTxs = await Promise.all(
        thresholds.map((t, i) =>
          contract.setMilestoneURI(BigInt(t), `${baseUrl}/api/metadata/milestone/${t}`, { nonce: milestoneNonce + i })
            .catch((e) => { console.warn(`[deploy] setMilestoneURI(${t}) submit failed: ${e.message}`); return null; })
        )
      );
      console.log(`[deploy] milestone URI txs submitted (nonces ${milestoneNonce}-${milestoneNonce + 2})`);
      // Wait for confirmations in background — don't block deploy-status becoming "ready"
      Promise.all(milestoneTxs.filter(Boolean).map((tx) => tx.wait(1, 60_000).catch(() => {})))
        .then(() => console.log("[deploy] milestone URIs confirmed"));
    } catch (e) {
      console.warn(`[deploy] milestone URI submission failed (non-fatal): ${e.message}`);
    }
  }

  // Persist new addresses to disk
  try {
    const contractStatePath = path.join(__dirname, "../../data/contractState.json");
    atomicWriteJSON(contractStatePath, { contractAddress: attendanceAddress, vryfTokenAddress: vryfAddress, deployedAt: Date.now() });
    console.log(`[deploy] addresses saved to contractState.json`);
  } catch (e) {
    console.warn(`[deploy] could not save contractState.json: ${e.message}`);
  }

  return { attendanceAddress, vryfAddress };
}

// ── Async deploy state ───────────────────────────────────────────────────────
// Tracks background contract deployment so the frontend can poll for completion
// instead of blocking on the ~45s deployment before reloading.
let deployState = { status: "idle", contractAddress: null, vryfTokenAddress: null, error: null };

function getDeployState() {
  return deployState;
}

async function deployContractsAsync() {
  deployState = { status: "deploying", contractAddress: null, vryfTokenAddress: null, error: null };
  try {
    const { attendanceAddress, vryfAddress } = await deployContracts();

    // Mark ready — milestone URI txs are already in the mempool (submitted with explicit
    // nonces inside deployContracts), so createEvent nonces won't collide with them.
    deployState = { status: "ready", contractAddress: attendanceAddress, vryfTokenAddress: vryfAddress, error: null };
  } catch (err) {
    deployState = { status: "error", contractAddress: null, vryfTokenAddress: null, error: err.message };
    console.error("[deploy] async deployment failed:", err.message);
  }
}

/**
 * Initialize the relayer with the deployer wallet (has ORGANIZER_ROLE)
 */
function initRelayer() {
  const privateKey = process.env.PRIVATE_KEY;

  // Prefer persisted address from last deployment over stale env var.
  // contractState.json is written by deployContracts() after every reset,
  // so Railway process restarts always use the most recently deployed contract.
  let contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  try {
    const contractStatePath = path.join(__dirname, "../../data/contractState.json");
    const saved = JSON.parse(fs.readFileSync(contractStatePath, "utf8"));
    if (saved.contractAddress && saved.contractAddress.startsWith("0x")) {
      contractAddress = saved.contractAddress;
      console.log(`[relayer] using persisted contract address from contractState.json: ${contractAddress}`);
    }
  } catch { /* file doesn't exist yet — use env var */ }

  if (!privateKey) {
    console.error("[relayer] FATAL: PRIVATE_KEY env var is not set — relayer cannot start");
    console.error("[relayer] Set PRIVATE_KEY in Railway Variables and redeploy");
    // Don't throw — let the server start so /api/health responds for debugging
    loadCustomCodesFromStore();
    return;
  }
  if (!contractAddress) {
    console.error("[relayer] FATAL: NEXT_PUBLIC_CONTRACT_ADDRESS env var is not set");
    loadCustomCodesFromStore();
    return;
  }

  const alchemyUrl = process.env.SEPOLIA_RPC;
  // Multiple public Sepolia RPCs as fallbacks — tried in order on 429
  rpcUrls = [
    ...(alchemyUrl ? [alchemyUrl] : []),
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org",
    "https://sepolia.drpc.org",
    "https://rpc2.sepolia.org",
    "https://sepolia.gateway.tenderly.co",
  ];
  rpcIndex = 0;
  provider = buildProviderForUrl(rpcUrls[0]);

  // Normalize private key — ethers v6 requires 0x prefix
  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  try {
    relayerWallet = new ethers.Wallet(normalizedKey, provider);
  } catch (e) {
    console.error("[relayer] FATAL: Invalid PRIVATE_KEY —", e.message);
    loadCustomCodesFromStore();
    return;
  }

  contract = new ethers.Contract(contractAddress, VryfdABI.abi, relayerWallet);
  loadCustomCodesFromStore();
  // Resolve fromBlock then sync missing attendee counts — all in background.
  (async () => {
    try {
      const latest = await provider.getBlockNumber();
      CONTRACT_DEPLOY_BLOCK = Math.max(0, latest - LOG_SCAN_BLOCKS);
      console.log(`[relayer] CONTRACT_DEPLOY_BLOCK resolved to ${CONTRACT_DEPLOY_BLOCK} (latest=${latest})`);
    } catch (e) {
      console.warn("[relayer] could not get block number:", e.message);
    }
    await syncMissingAttendeeCounts();
  })();
  console.log(`Relayer wallet: ${relayerWallet.address}`);
  console.log(`Using RPC: ${rpcUrls[0]}`);
  console.log(`Join codes loaded: ${JSON.stringify(Object.fromEntries(customCodeStore))}`);
}

function getContract() {
  if (!contract) throw new Error("Relayer not initialized");
  return contract;
}

function getProvider() {
  if (!provider) throw new Error("Relayer not initialized");
  return provider;
}

// ─── Organizer Actions (relayer pays gas) ─────────────────────────────────

/**
 * Create an event on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 */
async function createEvent(name, metadataURI, startTime, endTime) {
  return withRpcFallback(async () => {
    const c = getContract();
    const tx = await c.createEvent(name, metadataURI, BigInt(startTime), BigInt(endTime));
    const receipt = await tx.wait(1, 120_000); // 1 confirmation, 2-min timeout

    const iface = new ethers.Interface(VryfdABI.abi);
    let eventId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "EventCreated") {
          eventId = parsed.args[0].toString();
          break;
        }
      } catch {}
    }

    if (eventId === null) throw new Error("EventCreated log not found in receipt — event may not have been created");
    return { txHash: receipt.hash, eventId };
  });
}

/**
 * Issue a certificate on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 * Guards: attendance confirmed, event timing, no duplicate
 */
async function issueCertificate(eventId, attendee, metadataURI) {
  const c = getContract();

  const ev = await c.events(BigInt(eventId));
  const now = Math.floor(Date.now() / 1000);
  if (!ev.active) throw new Error("Event does not exist or is inactive");
  if (now < Number(ev.startTime)) throw new Error(`Event has not started yet (starts ${new Date(Number(ev.startTime) * 1000).toUTCString()})`);

  const record = await c.getAttendanceRecord(BigInt(eventId), attendee);
  if (Number(record.timestamp) === 0) throw new Error("Attendee has not confirmed attendance for this event");

  const totalCerts = Number(await c.nextCertificateId());
  for (let i = 1; i < totalCerts; i++) {  // start at 1 — slot 0 is unused (1-indexed)
    const cert = await c.certificates(BigInt(i));
    if (Number(cert.timestamp) === 0) continue;  // skip empty slots
    if (
      Number(cert.eventId) === Number(eventId) &&
      cert.attendee.toLowerCase() === attendee.toLowerCase() &&
      cert.isValid
    ) {
      throw new Error(`Certificate already issued (ID #${i})`);
    }
  }

  const tx = await c.issueCertificate(BigInt(eventId), attendee, metadataURI);
  const receipt = await tx.wait(1, 120_000);

  const iface = new ethers.Interface(VryfdABI.abi);
  let certificateId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "CertificateIssued") {
        certificateId = parsed.args[0].toString();
        break;
      }
    } catch {}
  }

  if (certificateId === null) throw new Error("CertificateIssued log not found in receipt");
  return { txHash: receipt.hash, certificateId };
}

/**
 * Read the current EIP-712 nonce for an attendee from chain.
 * Wrapped in withRpcFallback so a 429 from Alchemy auto-retries on a public RPC.
 */
async function getCheckinNonce(attendee) {
  return withRpcFallback(async () => {
    const c = getContract();
    return c.nonces(attendee);
  });
}

/**
 * Gasless POAP badge claim — attendee signed EIP-712, relayer pays gas.
 * Wrapped in withRpcFallback so Alchemy 429 on eth_sendRawTransaction retries on a public RPC.
 */
async function gaslessClaimBadge(attendee, onChainEventId, signature) {
  const sig = ethers.Signature.from(signature);
  const c = getContract();

  // Parallel pre-checks: attendance record + signing nonce + next badge tokenId.
  // Fetching all three at once saves ~400ms vs the old sequential approach.
  let onChainRecord, currentNonce, nextId;
  try {
    [onChainRecord, currentNonce, nextId] = await Promise.all([
      withRpcFallback(() => c.getAttendanceRecord(BigInt(onChainEventId), attendee)),
      withRpcFallback(() => c.nonces(attendee)),
      withRpcFallback(() => c.nextBadgeTokenId()),
    ]);
  } catch (e) {
    console.warn(`[gaslessClaimBadge] pre-checks failed: ${e.message} — proceeding`);
  }

  // If organizer's confirmAttendee tx is still in-flight, wait for it to mine
  // before submitting the badge mint (contract reverts with "Not attended" otherwise).
  if (Number(onChainRecord?.timestamp ?? 0) === 0) {
    const detail = confirmedAttendeesDetailStore.get(String(onChainEventId))?.get(attendee.toLowerCase());
    if (detail?.txHash) {
      console.log(`[gaslessClaimBadge] attendance tx pending (${detail.txHash}), waiting...`);
      try {
        await provider.waitForTransaction(detail.txHash, 1, 60_000);
        console.log(`[gaslessClaimBadge] attendance tx confirmed, proceeding`);
      } catch (e) {
        throw new Error("Attendance confirmation is still pending — please try again in a moment");
      }
    } else {
      throw new Error("Not attended");
    }
  }

  // Verify signature before burning a nonce on a guaranteed revert.
  if (currentNonce !== undefined) {
    try {
      const domain = { name: "VryfdAttendance", version: "1", chainId: 11155111, verifyingContract: c.target };
      const types = { ClaimBadge: [{ name: "attendee", type: "address" }, { name: "eventId", type: "uint256" }, { name: "nonce", type: "uint256" }] };
      const digest = ethers.TypedDataEncoder.hash(domain, types, { attendee, eventId: BigInt(onChainEventId), nonce: currentNonce });
      const recovered = ethers.recoverAddress(digest, sig);
      console.log(`[gaslessClaimBadge] sig check: expected=${attendee} recovered=${recovered} nonce=${currentNonce} contract=${c.target}`);
      if (recovered.toLowerCase() !== attendee.toLowerCase()) {
        throw new Error(`Invalid signature: signer mismatch — expected ${attendee}, recovered ${recovered}`);
      }
    } catch (e) {
      if (e.message.startsWith("Invalid signature:")) throw e;
      console.warn(`[gaslessClaimBadge] sig verify failed (non-fatal): ${e.message}`);
    }
  }

  const tx = await withRpcFallback(() =>
    c.claimBadgeGasless(attendee, BigInt(onChainEventId), sig.v, sig.r, sig.s)
  );

  // Predict the minted tokenId from nextBadgeTokenId snapshot (taken before tx submission).
  const tokenId = (nextId != null && BigInt(nextId) > 0n) ? nextId.toString() : null;
  console.log(`[gaslessClaimBadge] tx submitted: ${tx.hash}, predicted tokenId: ${tokenId}`);

  // Return immediately — don't block on tx.wait(). The frontend calls
  // waitForTransactionReceipt itself and parses the actual tokenId from logs.
  // Fire-and-forget wait here for server-side logging only.
  tx.wait(1, 120_000)
    .then((receipt) => {
      const iface = new ethers.Interface(VryfdABI.abi);
      let logTokenId = null;
      for (const log of receipt.logs ?? []) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "BadgeMinted") { logTokenId = parsed.args.tokenId.toString(); break; }
        } catch {}
      }
      console.log(`[gaslessClaimBadge] mined: ${receipt.hash}, tokenId from logs: ${logTokenId ?? tokenId}`);
    })
    .catch((e) => console.warn(`[gaslessClaimBadge] tx.wait() (background):`, e.message));

  return { txHash: tx.hash, tokenId };
}

/**
 * Gasless milestone reward — attendee signed EIP-712, relayer pays gas.
 * Pre-checks on-chain eligibility so the nonce is never consumed for a no-op tx.
 */
async function gaslessMilestoneReward(attendee, signature) {
  const c = getContract();

  // Single batch: fetch all needed state in parallel (was 2 sequential batches of 3 each).
  const [attended, highest, nextId] = await Promise.all([
    withRpcFallback(() => c.totalAttendance(attendee)),
    withRpcFallback(() => c.highestMilestoneClaimed(attendee)),
    withRpcFallback(() => c.nextMilestoneTokenId()),
  ]);

  const KNOWN_THRESHOLDS = [5n, 10n, 20n];
  const attendedN = BigInt(attended);
  const highestN  = BigInt(highest);
  const eligible  = KNOWN_THRESHOLDS.filter((t) => attendedN >= t && highestN < t);

  if (eligible.length === 0) {
    const maxThreshold = KNOWN_THRESHOLDS[KNOWN_THRESHOLDS.length - 1];
    if (highestN >= maxThreshold) {
      throw new Error(
        `All milestones already claimed! You have earned Bronze (5), Silver (10), and Gold (20). ` +
        `On-chain attendance: ${attendedN}.`
      );
    }
    const nextThreshold = KNOWN_THRESHOLDS.find((t) => highestN < t) ?? KNOWN_THRESHOLDS[0];
    throw new Error(
      `No unclaimed milestones reached yet. On-chain attendance: ${attendedN}, ` +
      `highest claimed: ${highestN}. You need at least ${nextThreshold} confirmed events for the next milestone.`
    );
  }

  // Predict which token IDs will be minted (sequential from nextMilestoneTokenId).
  let id = BigInt(nextId);
  const tokenIds = [];
  for (const t of KNOWN_THRESHOLDS) {
    if (attendedN >= t && highestN < t) { tokenIds.push(id.toString()); id++; }
  }

  const sig = ethers.Signature.from(signature);
  const tx = await withRpcFallback(() => {
    const c2 = getContract();
    return c2.milestoneRewardGasless(attendee, sig.v, sig.r, sig.s);
  });
  console.log(`[gaslessMilestoneReward] tx submitted: ${tx.hash}, predicted tokenIds: ${JSON.stringify(tokenIds)}`);

  // Return immediately with predicted tokenIds — don't block on tx.wait().
  // Frontend uses waitForTransactionReceipt for the MetaMask popup if needed.
  // Fire-and-forget wait just for server-side logging.
  tx.wait(1, 120_000)
    .then((receipt) => {
      const iface = new ethers.Interface(VryfdABI.abi);
      const fromLogs = [];
      for (const log of receipt.logs ?? []) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "MilestoneReached") fromLogs.push(parsed.args.tokenId.toString());
        } catch {}
      }
      console.log(`[gaslessMilestoneReward] mined: ${receipt.hash}, tokenIds from logs: ${JSON.stringify(fromLogs.length ? fromLogs : tokenIds)}`);
    })
    .catch((err) => console.warn(`[gaslessMilestoneReward] tx.wait() (background):`, err.message));

  return { txHash: tx.hash, tokenIds };
}

// Resolved at runtime — set to (currentBlock - LOG_SCAN_BLOCKS) on startup.
// Named constant so it's easy to change and easy to grep for all usages.
const LOG_SCAN_BLOCKS = 500_000; // ~70 days of Sepolia blocks
let CONTRACT_DEPLOY_BLOCK = 0;

async function queryFilterPaginated(contract, filter, fromBlock, toBlock) {
  // Try full range first (works with Alchemy and most RPCs)
  try {
    return await contract.queryFilter(filter, fromBlock, toBlock);
  } catch {}

  // Fall back to 500-block chunks
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += 500) {
    const end = Math.min(start + 499, toBlock);
    try {
      const chunk = await contract.queryFilter(filter, start, end);
      logs.push(...chunk);
    } catch (e) {
      console.warn(`queryFilter chunk [${start}-${end}] failed:`, e.message);
    }
  }
  return logs;
}

// Scan logs to get full attendee details (txHash + timestamp), cache and persist.
async function enrichAttendeesWithTxHash(onChainEventId) {
  const c = getContract();
  const filter = c.filters.AttendanceConfirmed(BigInt(onChainEventId));
  const latest = await provider.getBlockNumber();
  const logs = await queryFilterPaginated(c, filter, CONTRACT_DEPLOY_BLOCK, latest);
  const result = logs.map((log) => ({
    attendee: log.args[1],
    timestamp: Number(log.args[2]),
    txHash: log.transactionHash,
  }));
  for (const a of result) {
    addConfirmedAttendeeDetail(onChainEventId, a.attendee, a.timestamp, a.txHash);
    // Sync address store so confirmedCountStore and confirmedAttendeesStore stay consistent
    const key2 = String(onChainEventId);
    if (!confirmedAttendeesStore.has(key2)) confirmedAttendeesStore.set(key2, new Set());
    confirmedAttendeesStore.get(key2).add(a.attendee.toLowerCase());
  }
  // Update count store from chain truth — this is what attendee-count endpoint reads
  if (result.length > 0) {
    const key = String(onChainEventId);
    confirmedCountStore.set(key, confirmedAttendeesStore.get(key)?.size ?? result.length);
    try {
      const store = loadDeployedEvents();
      for (const info of Object.values(store)) {
        if (String(info.onChainId) === key) {
          const details = confirmedAttendeesDetailStore.get(key);
          info.confirmedAttendeesDetail = details ? [...details.values()] : [];
          info.confirmedAttendees = [...(confirmedAttendeesStore.get(key) ?? [])];
          info.confirmedCount = info.confirmedAttendees.length;
        }
      }
      atomicWriteJSON(STORE_PATH, store);
    } catch (e) {
      console.error("[store] enrichAttendeesWithTxHash persist failed:", e.message);
    }
  }
  return result;
}

/**
 * Get attendance record for a wallet+event.
 * Also returns the txHash of the confirmation tx.
 *
 * Timing gap fix: confirmAttendee adds the attendee to confirmedAttendeesDetailStore
 * immediately when the tx is submitted (optimistic), but tx.wait() runs in the background
 * and the chain read may return timestamp=0 for up to ~12 seconds (one Sepolia block).
 * We check the in-memory store first so "Check Status" reflects the organiser's action
 * the moment it happens, not a block later.
 */
async function getAttendanceRecord(eventId, attendee) {
  const c = getContract();

  // Fast path: organiser already confirmed in this session (detail store is populated
  // by confirmAttendee as soon as the tx is submitted, before the block is mined).
  const storeDetail = confirmedAttendeesDetailStore.get(String(eventId))?.get(attendee.toLowerCase());

  // Always read chain for badgeClaimed — that state only changes when the attendee
  // calls claimBadgeGasless, which is unrelated to the confirmation timing gap.
  const record = await c.getAttendanceRecord(BigInt(eventId), attendee);
  const onChainCheckedIn = Number(record.timestamp) > 0;

  // checkedIn = true if chain confirms it OR if the organiser's tx is in-flight
  const checkedIn = onChainCheckedIn || !!storeDetail;

  return {
    checkedIn,
    timestamp: onChainCheckedIn ? Number(record.timestamp) : (storeDetail?.timestamp ?? 0),
    badgeClaimed: record.badgeClaimed,
    txHash: storeDetail?.txHash ?? null,
  };
}

/**
 * Read all confirmed attendees for a given on-chain event ID.
 * Serves instantly from in-memory stores — no chain scan.
 * Detail cache has full data (timestamp + txHash) when populated during this session
 * or restored from disk. Falls back to address-only from confirmedAttendeesStore.
 */
async function getEventAttendees(onChainEventId) {
  const cached = getConfirmedAttendeesDetail(onChainEventId);
  if (cached !== null) return cached;

  // Detail cache cold — do a synchronous log scan with large chunks (fast with Alchemy).
  return enrichAttendeesWithTxHash(onChainEventId);
}

/**
 * Issue certificates to all confirmed attendees who don't have one yet.
 * Skips attendees that already have a valid certificate for the event.
 */
async function issueCertificatesBulk(onChainEventId, baseMetadataURI) {
  const c = getContract();

  // Use in-memory attendee store (populated on each confirmAttendee call) instead of
  // slow paginated log scan from deploy block — avoids thousands of RPC calls / 429s.
  // Falls back to log scan only if store is empty (e.g. first run after server restart
  // before any confirmations in this session).
  let attendeeAddresses = getConfirmedAttendees(onChainEventId);
  if (attendeeAddresses.length === 0) {
    const fromLogs = await getEventAttendees(onChainEventId);
    attendeeAddresses = fromLogs.map((a) => a.attendee);
    // Populate store from logs for future calls
    for (const addr of attendeeAddresses) {
      if (!confirmedAttendeesStore.has(String(onChainEventId))) confirmedAttendeesStore.set(String(onChainEventId), new Set());
      confirmedAttendeesStore.get(String(onChainEventId)).add(addr.toLowerCase());
    }
  }
  if (attendeeAddresses.length === 0) throw new Error("No attendees found for this event");

  // Use the event's real metadataURI (already pinned to IPFS at deploy time) as cert URI.
  // This ensures every certificate points to real on-chain content, not a placeholder.
  let certMetaURI = baseMetadataURI;
  if (!certMetaURI) {
    try {
      const ev = await c.events(BigInt(onChainEventId));
      certMetaURI = ev.metadataURI || "";
    } catch {
      certMetaURI = "";
    }
  }

  // Check attendance records sequentially — no sleep needed. Each eth_call naturally takes
  // ~100-200ms (network round-trip), which keeps us well under Alchemy's 330 CU/s limit.
  // Parallel batches caused 429 bursts when many attendees are checked simultaneously.
  const results = [];
  const eligible = [];
  for (const attendee of attendeeAddresses) {
    try {
      const record = await withRpcFallback(() => c.getAttendanceRecord(BigInt(onChainEventId), attendee));
      if (Number(record.timestamp) > 0) {
        eligible.push(attendee);
      } else {
        results.push({ attendee, status: "skipped", reason: "attendance not confirmed on-chain" });
      }
    } catch (err) {
      results.push({ attendee, status: "failed", reason: `RPC error: ${err.message}` });
    }
    // No explicit sleep — RPC latency (~100-200ms) is natural throttle
  }

  if (eligible.length === 0) return results;

  // Submit txs with explicit sequential nonces so all land in the mempool without
  // waiting for each block. Nonce is captured BEFORE each call — never inside a
  // retry lambda — so withRpcFallback retries always use the correct nonce value.
  let nonce = await provider.getTransactionCount(relayerWallet.address, "pending");
  const pendingTxs = [];

  for (const attendee of eligible) {
    const txNonce = nonce;
    try {
      const tx = await withRpcFallback(() =>
        c.issueCertificate(BigInt(onChainEventId), attendee, certMetaURI, { nonce: txNonce })
      );
      console.log(`[cert] submitted tx=${tx.hash} nonce=${txNonce} attendee=${attendee}`);
      pendingTxs.push({ attendee, tx });
      nonce++; // increment only after successful submission
    } catch (err) {
      const reason = err?.reason || err?.revert?.args?.[0] || err?.shortMessage || err?.message || "Unknown";
      console.error(`[cert] submit failed attendee=${attendee} nonce=${txNonce}: ${reason}`);
      results.push({ attendee, status: "failed", reason });
      // tx was NOT submitted — nonce unchanged, no increment needed
    }
  }

  if (pendingTxs.length === 0) return results;

  // Single polling loop — one getTransactionReceipt per tx per cycle instead of
  // N independent tx.wait() calls each polling eth_blockNumber (causes 429 bursts).
  const pending = new Map(pendingTxs.map(({ attendee, tx }) => [tx.hash, attendee]));
  const receiptMap = new Map();
  const deadline = Date.now() + 120_000;

  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(1_000);
    for (const hash of [...pending.keys()]) {
      try {
        const receipt = await provider.getTransactionReceipt(hash);
        if (receipt?.blockNumber != null) {
          receiptMap.set(hash, receipt);
          pending.delete(hash);
        }
      } catch {}
      await sleep(150); // small gap between receipt checks to stay under CU limit
    }
  }

  for (const { attendee, tx } of pendingTxs) {
    const receipt = receiptMap.get(tx.hash);
    if (!receipt) {
      console.error(`[cert] timeout attendee=${attendee} tx=${tx.hash}`);
      results.push({ attendee, status: "failed", reason: "tx not mined within 2 minutes" });
    } else if (receipt.status === 0) {
      console.error(`[cert] reverted attendee=${attendee} tx=${receipt.hash}`);
      results.push({ attendee, status: "failed", reason: "tx reverted on-chain (possibly already certified)" });
    } else {
      console.log(`[cert] issued attendee=${attendee} event=${onChainEventId} tx=${receipt.hash}`);
      results.push({ attendee, status: "issued", txHash: receipt.hash });
    }
  }

  return results;
}

/**
 * Organizer marks an attendee as present on-chain (RELAYER_ROLE, relayer pays gas)
 * Requires the attendee's EIP-712 CheckIn signature stored in the pending queue.
 */
async function markAttendance(eventId, attendee) {
  // Delegates to confirmAttendee which uses confirmAttendanceGasless with stored signature
  return confirmAttendee(eventId, attendee);
}

/**
 * Gasless check-in — user signs EIP-712 message, relayer submits to chain and pays gas
 * The contract verifies the signature matches the attendee and increments their nonce
 */
async function gaslessCheckin(attendee, eventId, signature) {
  const c = getContract();

  // Split the 65-byte hex signature into v, r, s components
  const sig = ethers.Signature.from(signature);

  const tx = await c.confirmAttendanceGasless(
    attendee,
    BigInt(eventId),
    sig.v,
    sig.r,
    sig.s
  );
  const receipt = await tx.wait(1, 120_000);
  if (!receipt) throw new Error("Transaction failed — no receipt returned");

  return { txHash: receipt.hash };
}

/**
 * Fetch all certificates issued for a given on-chain event ID.
 * Resolves ENS names for each attendee via mainnet reverse lookup.
 */
async function getEventCertificates(onChainEventId) {
  const c = getContract();
  const total = Number(await c.nextCertificateId());
  const raw = [];
  for (let i = 1; i < total; i++) {  // start at 1 — slot 0 is unused
    const cert = await c.certificates(BigInt(i));
    if (Number(cert.timestamp) === 0) continue;  // skip empty slots
    if (Number(cert.eventId) === Number(onChainEventId)) {
      raw.push({
        certId: i,
        attendee: cert.attendee,
        timestamp: Number(cert.timestamp),
        metadataURI: cert.metadataURI,
        isValid: cert.isValid,
      });
    }
  }

  // Resolve ENS names in parallel — mainnet reverse lookup
  let mainnetProvider = null;
  try {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    mainnetProvider = new ethers.JsonRpcProvider(
      alchemyKey
        ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : "https://eth.llamarpc.com"
    );
  } catch {}

  const ENS_TIMEOUT_MS = 3000;
  await Promise.all(
    raw.map(async (entry) => {
      const override = getENSOverride(entry.attendee);
      if (override) { entry.attendeeENS = override; return; }
      if (!mainnetProvider) return;
      try {
        const ens = await Promise.race([
          mainnetProvider.lookupAddress(entry.attendee),
          new Promise((_, reject) => setTimeout(() => reject(new Error("ENS timeout")), ENS_TIMEOUT_MS)),
        ]);
        if (ens) entry.attendeeENS = ens;
      } catch {}
    })
  );

  return raw;
}

/**
 * Revoke a certificate on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 */
async function revokeCertificate(certificateId) {
  const c = getContract();
  const tx = await c.revokeCertificate(BigInt(certificateId));
  const receipt = await tx.wait(1, 120_000);
  return { txHash: receipt.hash };
}

/**
 * Set milestone token URIs on-chain for all 3 tiers (organizer only)
 * Called once at startup so milestone NFTs have images
 */
async function setMilestoneURIs(baseURL) {
  const c = getContract();
  const thresholds = [5, 10, 20];

  // Check if already set — skip the whole setup if Bronze URI is already on-chain
  try {
    const existing = await c.milestoneTokenURIs(BigInt(5));
    if (existing && existing.length > 0) {
      console.log("[setMilestoneURIs] already set, skipping");
      return [];
    }
  } catch {
    // Contract may not expose milestoneTokenURIs as public — proceed anyway
  }

  // Submit all 3 transactions (sequential — same nonce-locked wallet, must be serial)
  const txs = [];
  for (const t of thresholds) {
    const uri = `${baseURL}/api/metadata/milestone/${t}`;
    const tx = await c.setMilestoneURI(BigInt(t), uri);
    txs.push({ threshold: t, uri, tx });
  }

  // Wait for receipts in parallel — each tx.wait() polls independently
  const results = await Promise.all(
    txs.map(async ({ threshold, uri, tx }) => {
      try {
        const receipt = await tx.wait(1, 120_000);
        return { threshold, uri, txHash: receipt.hash };
      } catch {
        // Receipt polling timed out (Alchemy 429) — tx is likely already mined
        return { threshold, uri, txHash: tx.hash };
      }
    })
  );
  return results;
}

/**
 * Fix a badge token's on-chain URI for a given on-chain event.
 * Looks up the badge token ID via eventBadgeToken(onChainEventId), then calls
 * setTokenURI(tokenId, newURI) on the contract. Requires the contract to have
 * been redeployed with the setTokenURI admin function.
 */
async function fixBadgeTokenURI(onChainEventId, newURI) {
  const c = getContract();
  const tokenId = await c.eventBadgeToken(BigInt(onChainEventId));
  const tx = await c.setTokenURI(tokenId, newURI);
  const receipt = await tx.wait(1, 120_000);
  return { txHash: receipt.hash, tokenId: tokenId.toString(), newURI };
}

/**
 * Query the contract's AttendanceConfirmed logs to get the real on-chain attendee count.
 * Reads from in-memory store first (fast); falls back to a chain log scan when the store
 * is empty so cold starts always return the correct count.
 */
async function getOnChainAttendeeCount(onChainEventId) {
  const cached = getConfirmedCount(onChainEventId);
  if (cached > 0) return cached;
  // Store empty — scan chain logs (also populates all stores as a side-effect)
  try {
    const attendees = await enrichAttendeesWithTxHash(onChainEventId);
    return attendees.length;
  } catch {
    return 0;
  }
}

// On startup: for any event missing confirmedCount, scan chain logs and fill in the store.
async function syncMissingAttendeeCounts() {
  try {
    const store = loadDeployedEvents();
    const c = getContract();
    const latest = await provider.getBlockNumber();
    let updated = false;
    for (const [appId, info] of Object.entries(store)) {
      if (info.onChainId === undefined || info.onChainId === null) continue;
      if (info.confirmedCount > 0) continue; // already tracked
      const onChainId = String(info.onChainId);
      try {
        const filter = c.filters.AttendanceConfirmed(BigInt(onChainId));
        const logs = await queryFilterPaginated(c, filter, CONTRACT_DEPLOY_BLOCK, latest);
        if (logs.length > 0) {
          const attendees = logs.map((l) => l.args[1]);
          confirmedCountStore.set(onChainId, logs.length);
          if (!confirmedAttendeesStore.has(onChainId)) confirmedAttendeesStore.set(onChainId, new Set());
          attendees.forEach((a) => confirmedAttendeesStore.get(onChainId).add(a.toLowerCase()));
          info.confirmedCount = logs.length;
          info.confirmedAttendees = [...confirmedAttendeesStore.get(onChainId)];
          console.log(`[sync] event app=${appId} onChain=${onChainId} → ${logs.length} attendee(s) synced from chain`);
          updated = true;
        }
      } catch (err) {
        console.warn(`[sync] could not scan logs for onChainId=${onChainId}:`, err.message);
      }
    }
    if (updated) atomicWriteJSON(STORE_PATH, store);
  } catch (err) {
    console.warn("[sync] attendee count sync failed:", err.message);
  }
}

module.exports = {
  initRelayer,
  createEvent,
  getConfirmedCount,
  getOnChainAttendeeCount,
  syncMissingAttendeeCounts,
  getConfirmedAttendees,
  getEventCertificates,
  getCheckinNonce,
  generateJoinCode,
  getJoinCode,
  setCustomCode,
  setEventMeta,
  joinCodeCheckin,
  addPending,
  getPendingAttendees,
  confirmAttendee,
  confirmAllAttendees,
  getEventAttendees,
  issueCertificatesBulk,
  markAttendance,
  gaslessCheckin,
  issueCertificate,
  revokeCertificate,
  getAttendanceRecord,
  saveDeployedEvent,
  getDeployedEvents,
  resetDeployedEvents,
  getAllEvents,
  saveAllEvents,
  setMilestoneURIs,
  fixBadgeTokenURI,
  gaslessClaimBadge,
  gaslessMilestoneReward,
  deployContracts,
  deployContractsAsync,
  getDeployState,
  clearAllDeployedEvents,
  getContract,
  getProvider,
};
