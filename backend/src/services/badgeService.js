/**
 * VryfdBadge (ERC-721 POAP) service.
 *
 * Thin wrapper around the on-chain badge contract:
 *   - setEventBadge(eventId, metadataURI)        — organizer registers badge artwork
 *   - gaslessClaimBadge(attendee, eventId, sig)  — relayer submits attendee's signed claim
 *   - getEventBadge(eventId)                     — read registered URI
 *   - getMyBadges(attendee)                      — enumerate attendee's badges
 *
 * Piggy-backs on relayerService for the wallet, provider, RPC-fallback, and chainId cache
 * so we don't maintain a second wallet/provider pair.
 */
const { ethers } = require("ethers");
const VryfdBadgeABI = require("../abis/VryfdBadge.json");
const VryfdAttendanceABI = require("../abis/VryfdAttendance.json");
const {
  getRelayerWallet,
  getProvider,
  withRpcFallback,
  getChainId,
} = require("./relayerService");

function getBadgeAddress() {
  const addr = process.env.NEXT_PUBLIC_BADGE_CONTRACT_ADDRESS;
  if (!addr) throw new Error("NEXT_PUBLIC_BADGE_CONTRACT_ADDRESS not set — run scripts/deploy-badge.js first");
  return addr;
}

// Always build from the current relayer wallet (which may have been swapped to a
// fallback RPC by withRpcFallback), so badge calls also use the active provider.
function getBadgeContract() {
  return new ethers.Contract(getBadgeAddress(), VryfdBadgeABI.abi, getRelayerWallet());
}

function getBadgeReadContract() {
  return new ethers.Contract(getBadgeAddress(), VryfdBadgeABI.abi, getProvider());
}

/**
 * Read the EIP-712 domain the frontend should use for signing ClaimBadge messages.
 * Returned to the client so signing is reproducible without hardcoding values.
 */
async function getClaimDomain() {
  const chainId = await getChainId();
  return {
    name: "VryfdBadge",
    version: "1",
    chainId,
    verifyingContract: getBadgeAddress(),
  };
}

/**
 * Organizer sets (or updates) the badge metadata URI for an event.
 * Caller address MUST be the relayer wallet which has ORGANIZER_ROLE on the contract.
 * (Organizers trigger this via the backend, not by sending their own tx.)
 */
async function setEventBadge(eventId, metadataURI) {
  if (!metadataURI || typeof metadataURI !== "string" || metadataURI.length > 512) {
    throw new Error("Invalid metadataURI");
  }
  return withRpcFallback(async () => {
    const c = getBadgeContract();
    const tx = await c.setEventBadge(BigInt(eventId), metadataURI);
    console.log(`[badge.setEventBadge] eventId=${eventId} tx=${tx.hash}`);
    try {
      await tx.wait(1, 90_000);
    } catch (e) {
      console.warn(`[badge.setEventBadge] tx.wait failed: ${e.message}`);
    }
    return { txHash: tx.hash, metadataURI };
  });
}

/**
 * Read the currently-registered badge URI for an event (empty string if not set).
 */
async function getEventBadge(eventId) {
  return withRpcFallback(async () => {
    const c = getBadgeReadContract();
    const uri = await c.eventBadgeURI(BigInt(eventId));
    return uri || "";
  });
}

/**
 * Read whether an attendee has already claimed a given event's badge.
 */
async function hasClaimedBadge(eventId, attendee) {
  return withRpcFallback(async () => {
    const c = getBadgeReadContract();
    return Boolean(await c.hasClaimed(BigInt(eventId), attendee));
  });
}

/**
 * Read the current EIP-712 nonce for an attendee (separate from the attendance contract's nonce).
 */
async function getClaimNonce(attendee) {
  return withRpcFallback(async () => {
    const c = getBadgeReadContract();
    const n = await c.nonces(attendee);
    return Number(n);
  });
}

/**
 * Submit an attendee's signed ClaimBadge message — the relayer pays gas, and the
 * contract verifies the signature + eligibility (threshold) before minting.
 */
async function gaslessClaimBadge(attendee, eventId, signature) {
  const sig = ethers.Signature.from(signature);
  return withRpcFallback(async () => {
    const c = getBadgeContract();
    // Simulate first to surface revert reasons before we spend a nonce.
    try {
      await c.claimBadgeGasless.staticCall(attendee, BigInt(eventId), sig.v, sig.r, sig.s);
    } catch (e) {
      const reason = (e?.reason || e?.shortMessage || e?.message || "").toString();
      if (reason.includes("BadgeAlreadyClaimed"))  throw new Error("Badge already claimed");
      if (reason.includes("BadgeMetadataNotSet"))  throw new Error("Organizer has not configured a badge for this event yet");
      if (reason.includes("NotEligible"))          throw new Error("Attendance threshold not met");
      if (reason.includes("InvalidSignature"))     throw new Error("Signature does not match attendee");
      throw e;
    }

    const tx = await c.claimBadgeGasless(attendee, BigInt(eventId), sig.v, sig.r, sig.s);
    console.log(`[badge.gaslessClaimBadge] tx=${tx.hash} attendee=${attendee} eventId=${eventId}`);

    let receipt = null;
    try {
      receipt = await tx.wait(1, 120_000);
    } catch (e) {
      console.warn(`[badge.gaslessClaimBadge] tx.wait failed: ${e.message}`);
    }

    // Parse BadgeClaimed log for the minted tokenId. Fall back to reading the last
    // token from tokensOfOwner if the log isn't available (e.g. indexer lag).
    let tokenId = null;
    let metadataURI = null;
    if (receipt?.logs?.length) {
      const iface = new ethers.Interface(VryfdBadgeABI.abi);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "BadgeClaimed") {
            tokenId    = parsed.args.tokenId.toString();
            metadataURI = parsed.args.metadataURI;
            break;
          }
        } catch {}
      }
    }
    if (!tokenId) {
      try {
        const c2 = getBadgeReadContract();
        const ids = await c2.tokensOfOwner(attendee);
        if (ids.length > 0) tokenId = ids[ids.length - 1].toString();
      } catch {}
    }

    return {
      txHash: receipt?.hash ?? tx.hash,
      tokenId,
      metadataURI,
      contract: getBadgeAddress(),
    };
  });
}

/**
 * Check on-chain whether an attendee is currently eligible to claim a badge:
 * attendance threshold reached + still inside the claim period (if configured).
 * Reads directly from the existing VryfdAttendance contract — the same gate the
 * badge contract enforces at mint time, so the UI can hide / disable the button.
 */
async function isEligible(eventId, attendee) {
  return withRpcFallback(async () => {
    const attendanceAddr = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    if (!attendanceAddr) return false;
    const c = new ethers.Contract(attendanceAddr, VryfdAttendanceABI.abi, getProvider());
    return Boolean(await c.isEligibleForCertificate(BigInt(eventId), attendee));
  });
}

/**
 * Enumerate an attendee's badges. Each entry has the tokenId, the eventId it was
 * minted for, and the metadata URI that was frozen into the token at mint time.
 */
async function getMyBadges(attendee) {
  return withRpcFallback(async () => {
    const c = getBadgeReadContract();
    const ids = await c.tokensOfOwner(attendee);
    const out = [];
    for (const id of ids) {
      try {
        // ownerOf acts as existence check — skips burned tokens
        const owner = await c.ownerOf(id);
        if (owner.toLowerCase() !== attendee.toLowerCase()) continue;
        const [uri, eventId] = await Promise.all([
          c.tokenURI(id),
          c.tokenEvent(id),
        ]);
        out.push({
          tokenId: id.toString(),
          eventId: eventId.toString(),
          tokenURI: uri,
          contract: getBadgeAddress(),
        });
      } catch {
        // ignore burned / inaccessible
      }
    }
    return out;
  });
}

module.exports = {
  getBadgeAddress,
  getClaimDomain,
  setEventBadge,
  getEventBadge,
  hasClaimedBadge,
  getClaimNonce,
  gaslessClaimBadge,
  getMyBadges,
  isEligible,
};
