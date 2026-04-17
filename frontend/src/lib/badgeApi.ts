/**
 * Client-side helper for the VryfdBadge ERC-721 POAP contract.
 *
 * Talks to the backend at /api/badge/*, prompts MetaMask for the EIP-712
 * ClaimBadge signature, and offers a helper to add the minted NFT to the user's
 * MetaMask wallet via wallet_watchAsset.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export interface BadgeConfig {
  contract: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    ClaimBadge: { name: string; type: string }[];
  };
}

export interface MyBadge {
  tokenId: string;
  eventId: string;
  tokenURI: string;
  contract: string;
}

export interface ClaimResult {
  success: boolean;
  txHash: string;
  tokenId: string | null;
  metadataURI: string | null;
  contract: string;
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
}

function getEthereum(): EthereumProvider {
  const eth = (globalThis as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error("MetaMask not detected — please install or unlock it");
  return eth;
}

/**
 * Make sure MetaMask is on the same network as the contract (Sepolia testnet
 * in our case). EIP-712 signing requires the wallet's active chainId to match
 * the typed-data domain's chainId, otherwise MetaMask refuses to sign with
 * "Provided chainId 'X' must match the active chainId 'Y'".
 */
async function ensureChain(targetChainId: number): Promise<void> {
  const eth = getEthereum();
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  const currentDec = parseInt(current, 16);
  if (currentDec === targetChainId) return;

  const hexId = "0x" + targetChainId.toString(16);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    } as { method: string; params: object });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    // 4902 = chain not known to MetaMask → try to add it.
    if (e?.code === 4902 && targetChainId === 11155111) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xaa36a7",
          chainName: "Sepolia",
          rpcUrls: ["https://rpc.sepolia.org"],
          nativeCurrency: { name: "SepoliaETH", symbol: "SEP", decimals: 18 },
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      } as { method: string; params: object });
    } else if (e?.code === 4001) {
      throw new Error("You cancelled the network switch — Sepolia is required to claim badges.");
    } else {
      throw new Error(
        `Please switch MetaMask to Sepolia testnet (chainId ${targetChainId}) to continue. ${e?.message ?? ""}`.trim()
      );
    }
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Bad response from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg =
      (parsed as { error?: string })?.error ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}

export async function getBadgeConfig(): Promise<BadgeConfig> {
  return jsonFetch<BadgeConfig>(`${BACKEND_URL}/api/badge/config`);
}

export async function getClaimNonce(address: string): Promise<number> {
  const { nonce } = await jsonFetch<{ nonce: number }>(
    `${BACKEND_URL}/api/badge/claim-nonce/${address}`
  );
  return nonce;
}

export async function getEventBadge(
  eventId: number | string
): Promise<{ eventId: string; metadataURI: string; configured: boolean }> {
  return jsonFetch(`${BACKEND_URL}/api/badge/event/${eventId}`);
}

export async function getClaimStatus(
  eventId: number | string,
  address: string
): Promise<boolean> {
  const { claimed } = await jsonFetch<{ claimed: boolean }>(
    `${BACKEND_URL}/api/badge/claim-status?eventId=${eventId}&address=${address}`
  );
  return claimed;
}

export async function getMyBadges(address: string): Promise<MyBadge[]> {
  const { badges } = await jsonFetch<{ badges: MyBadge[] }>(
    `${BACKEND_URL}/api/badge/mine/${address}`
  );
  return badges;
}

/**
 * Organizer-only: register (or update) the badge metadata URI for an event.
 * Requires an authenticated organizer/admin JWT in localStorage as `vryfd_token`.
 */
export async function setEventBadgeMetadata(
  eventId: number | string,
  metadataURI: string
): Promise<{ success: boolean; txHash: string; metadataURI: string }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("vryfd_token") : null;
  return jsonFetch(`${BACKEND_URL}/api/badge/set-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ eventId, metadataURI }),
  });
}

/**
 * Organizer-only: upload a badge image to IPFS and produce the full metadata
 * JSON pin. Returns the `ipfs://` URI of the metadata — ready to pass to
 * setEventBadgeMetadata.
 */
export async function uploadBadgeArtwork(params: {
  file: File;
  eventName: string;
  eventId: number | string;
  description?: string;
  eventDate?: string;
  organizer?: string;
}): Promise<{ metadataURI: string; imageCID: string; metadataCID: string }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("vryfd_token") : null;

  const form = new FormData();
  form.append("image", params.file);
  const imageRes = await fetch(`${BACKEND_URL}/api/ipfs/upload-image`, {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const imageText = await imageRes.text();
  const imageData = imageText ? JSON.parse(imageText) : {};
  if (!imageRes.ok) throw new Error(imageData?.error || "Image upload failed");
  const imageCID = imageData.cid as string;
  // When Pinata isn't configured the backend returns a localhost URL instead
  // of an ipfs:// URI. We pass both — the metadata builder picks whichever it
  // finds, and the on-chain URI ends up resolvable in either case.
  const imageUrl = imageData.url as string | undefined;

  const metaRes = await fetch(`${BACKEND_URL}/api/ipfs/badge-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      eventName: params.eventName,
      eventId: params.eventId,
      description: params.description,
      imageCID,
      imageUrl,
      eventDate: params.eventDate,
      organizer: params.organizer,
    }),
  });
  const metaText = await metaRes.text();
  const metaData = metaText ? JSON.parse(metaText) : {};
  if (!metaRes.ok) throw new Error(metaData?.error || "Metadata pin failed");

  return {
    metadataURI: metaData.uri as string,
    imageCID,
    metadataCID: metaData.cid as string,
  };
}

/**
 * Attendee claim flow: sign EIP-712 → send to backend relayer → optionally add
 * the resulting NFT to MetaMask. Throws on any failure step.
 */
export async function claimBadgeGasless(
  attendee: string,
  eventId: number | string
): Promise<ClaimResult> {
  if (!attendee) throw new Error("Connect your wallet first");
  const [config, nonce] = await Promise.all([
    getBadgeConfig(),
    getClaimNonce(attendee),
  ]);

  // MetaMask refuses to sign EIP-712 with a domain chainId that doesn't match
  // the wallet's active network — prompt a switch up front (once) instead of
  // letting the sign call blow up with a confusing "chainId must match" error.
  await ensureChain(config.domain.chainId);

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ClaimBadge: config.types.ClaimBadge,
    },
    primaryType: "ClaimBadge",
    domain: config.domain,
    message: {
      attendee,
      eventId: String(eventId),
      nonce: String(nonce),
    },
  };

  const eth = getEthereum();
  let signature: string;
  try {
    const raw = await eth.request({
      method: "eth_signTypedData_v4",
      params: [attendee, JSON.stringify(typedData)],
    });
    if (typeof raw !== "string" || !raw.startsWith("0x") || raw.length < 132) {
      console.error("[badgeApi] bad signature from wallet:", raw);
      throw new Error(
        `Wallet returned an invalid signature (${typeof raw === "string" ? `length=${raw.length}` : typeof raw}). ` +
        "Try refreshing the page and make sure the address in MetaMask matches your connected wallet."
      );
    }
    signature = raw;
  } catch (err) {
    // Normalise MetaMask's non-Error objects so upstream handlers can read err.message / err.code.
    const e = err as { code?: number; message?: string };
    if (e?.code === 4001) throw new Error("You cancelled the signature request");
    if (e?.message) throw new Error(e.message);
    throw new Error("Signature request failed — see browser console for details");
  }

  const result = await jsonFetch<ClaimResult>(
    `${BACKEND_URL}/api/badge/claim-gasless`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendee, eventId: Number(eventId), signature }),
    }
  );
  return result;
}

/**
 * Ask MetaMask to watch the minted NFT so it shows up in the user's NFTs tab
 * without needing a manual "Import NFT" step. MetaMask supports ERC-721 via
 * wallet_watchAsset since MM 11.x — on older versions this will silently fail.
 */
export async function watchNftInMetaMask(
  contract: string,
  tokenId: string
): Promise<boolean> {
  try {
    const eth = getEthereum();
    const result = await eth.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC721",
        options: {
          address: contract,
          tokenId,
        },
      },
    } as { method: string; params: object });
    return Boolean(result);
  } catch (err) {
    console.warn("[badgeApi] wallet_watchAsset failed (can be added manually):", err);
    return false;
  }
}
