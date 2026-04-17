/**
 * promptAddNft — production-ready MetaMask EIP-747 NFT import.
 *
 * ─── Usage contract ──────────────────────────────────────────────────────────
 *
 *   ✅ Correct — gesture context preserved across the entire async chain:
 *
 *     button.onclick = async () => {
 *       // 1. Connect / ping wallet FIRST — captures the user-gesture frame.
 *       //    Already-connected wallets return silently (no popup).
 *       await ethereum.request({ method: "eth_requestAccounts" });
 *
 *       // 2. Wait for mint confirmation (as many awaits as needed — same chain).
 *       const receipt = await publicClient.waitForTransactionReceipt({ hash });
 *
 *       // 3. Import immediately — no delay, still in the user-gesture async chain.
 *       promptAddNft({ contractAddr, tokenId, onToast, delay: 0 });
 *     };
 *
 *   ❌ Broken — setTimeout creates a new macrotask, losing gesture context:
 *
 *     button.onclick = () => {
 *       promptAddNft({ contractAddr, tokenId, onToast, delay: 900 });
 *       // MetaMask silently suppresses the popup on most browser/wallet combos.
 *     };
 *
 * ─── Critical invariants ─────────────────────────────────────────────────────
 *   1. tokenId is always sent as a decimal string.
 *      MetaMask silently rejects numeric / BigInt / hex token IDs.
 *   2. window.ethereum is used directly — NOT wagmi walletClient.watchAsset(),
 *      which serialises tokenId as a JavaScript BigInt (number in JSON), causing
 *      MetaMask to silently reject the request.
 *   3. ERC1155 is tried before ERC721 (MetaMask ≥v11.7 requires the ERC1155 type
 *      for EIP-1155 tokens; older builds fall through to the ERC721 path).
 *   4. delay = 0 executes wallet_watchAsset directly in the caller's async chain
 *      (no setTimeout). delay > 0 defers via setTimeout — acceptable only when
 *      no interactive gesture frame exists (background auto-prompts).
 *   5. Caller is responsible for confirming the token exists on-chain before
 *      invoking this function. MetaMask validates token existence at import time.
 *
 * If any invariant is broken, the MetaMask popup silently disappears and users
 * see only the fallback toast. All invariants are guarded by the test suite in
 * __tests__/promptAddNft.test.ts.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SEPOLIA_CHAIN_ID = "0xaa36a7" as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal EIP-1193 provider surface used by this module.
 * params is optional — some calls (eth_chainId) send no params.
 */
export interface NftProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

export interface PromptAddNftOptions {
  /** ERC-1155 / ERC-721 contract address. */
  contractAddr: string;
  /**
   * Token ID — decimal string, hex string, or numeric string.
   * Normalised to a decimal string internally (invariant 1).
   */
  tokenId: string;
  /** Called only when MetaMask confirmed the add (wallet_watchAsset returned true). */
  onSuccess?: () => void;
  /**
   * Milliseconds to wait before firing wallet_watchAsset.
   *   0  — execute directly in the caller's async chain (requires eth_requestAccounts
   *        to have been called first in the same gesture frame).
   *   >0 — deferred via setTimeout; gesture context is lost. Use only for background
   *        / automatic post-mint prompts where no button gesture exists.
   * Default: 900 (historical fallback for callers without a gesture frame).
   */
  delay?: number;
  /**
   * Override the EIP-1193 provider. Defaults to window.ethereum.
   * Set in tests only — production callers must never pass this.
   */
  provider?: NftProvider | null;
  /** UI feedback callback. Receives the message string and a severity type. */
  onToast: (msg: string, type: "success" | "") => void;
}

/**
 * Typed outcome returned by tryAddNftImport.
 * Use this to compose custom UX instead of relying on the default toasts.
 *
 *   "added"        — user clicked Add in MetaMask.
 *   "dismissed"    — MetaMask processed the request; user clicked Cancel,
 *                    or the token is already tracked in the wallet.
 *   "unsupported"  — wallet threw for both ERC1155 and ERC721; the wallet
 *                    does not support wallet_watchAsset for NFTs.
 *   "wrong_chain"  — user rejected the Sepolia chain switch AND both types threw.
 *                    The wallet is on a different network with no cross-chain support.
 */
export type AddNftOutcome =
  | { status: "added" }
  | { status: "dismissed" }
  | { status: "unsupported" }
  | { status: "wrong_chain" };

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Low-level wallet_watchAsset implementation. Returns a typed AddNftOutcome.
 *
 * Exported separately so callers that need direct control (e.g. handleAddToWallet)
 * can compose their own UX without going through the default toast callbacks.
 *
 * Pre-conditions (enforced by promptAddNft; call-site must uphold when used directly):
 *   - provider is non-null
 *   - decimalTokenId is a valid non-zero decimal string
 *   - eth_requestAccounts has been called in the current user-gesture frame
 */
export async function tryAddNftImport(
  provider: NftProvider,
  contractAddr: string,
  decimalTokenId: string,
): Promise<AddNftOutcome> {
  // ── Chain guard ────────────────────────────────────────────────────────────
  // wallet_watchAsset validates NFT ownership on the CONNECTED chain.
  // A mainnet wallet will not find a Sepolia token and returns silently.
  // Attempt a chain switch; if the user declines, mark it and proceed — some
  // recent wallet builds handle wallet_watchAsset cross-chain gracefully.
  let chainSwitchRejected = false;
  try {
    const currentChain = await provider.request({ method: "eth_chainId" });
    if (currentChain !== SEPOLIA_CHAIN_ID) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    }
  } catch {
    chainSwitchRejected = true;
  }

  // ── wallet_watchAsset ──────────────────────────────────────────────────────
  const watchAsset = (type: "ERC1155" | "ERC721"): Promise<boolean> =>
    provider.request({
      method: "wallet_watchAsset",
      params: { type, options: { address: contractAddr, tokenId: decimalTokenId } },
    }) as Promise<boolean>;

  let walletProcessed = false; // true once wallet_watchAsset runs without throwing

  // ERC1155 first — required by MetaMask ≥v11.7 for EIP-1155 tokens.
  try {
    const accepted = await watchAsset("ERC1155");
    walletProcessed = true;
    if (accepted) return { status: "added" };
    // accepted=false: wallet processed the request but the user dismissed or the token
    // is already tracked. Fall through to ERC721 — older MetaMask builds may support
    // the ERC1155 method but return false without showing a popup; ERC721 may work there.
  } catch { /* ERC1155 not supported by this wallet version — try ERC721 */ }

  // ERC721 fallback — MetaMask handles ERC-1155 tokens with this type on older builds.
  try {
    const accepted = await watchAsset("ERC721");
    walletProcessed = true;
    if (accepted) return { status: "added" };
  } catch { /* ERC721 also unsupported */ }

  if (walletProcessed) return { status: "dismissed" };
  return chainSwitchRejected ? { status: "wrong_chain" } : { status: "unsupported" };
}

// ─── Message factories (private) ──────────────────────────────────────────────

function etherscanTokenUrl(contractAddr: string, tokenId: string): string {
  return `https://sepolia.etherscan.io/token/${contractAddr}?a=${tokenId}`;
}

function manualImportInstructions(contractAddr: string, tokenId: string): string {
  return (
    `NFT minted ✓  To add: MetaMask → NFTs tab → Import NFT` +
    ` → Contract: ${contractAddr.slice(0, 8)}… Token ID: ${tokenId}` +
    ` | Etherscan: ${etherscanTokenUrl(contractAddr, tokenId)}`
  );
}

function alreadyTrackedInstructions(contractAddr: string, tokenId: string): string {
  return (
    `NFT is in your wallet ✓ — check MetaMask → NFTs tab.` +
    ` Not showing? Import NFT → Contract: ${contractAddr.slice(0, 8)}… Token ID: ${tokenId}` +
    ` | Etherscan: ${etherscanTokenUrl(contractAddr, tokenId)}`
  );
}

function wrongChainInstructions(contractAddr: string, tokenId: string): string {
  return (
    `Switch your wallet to Sepolia to add this NFT,` +
    ` or import manually: MetaMask → NFTs tab → Import NFT → Token ID: ${tokenId}` +
    ` | Etherscan: ${etherscanTokenUrl(contractAddr, tokenId)}`
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to import an ERC-1155 / ERC-721 NFT via wallet_watchAsset and display
 * an appropriate toast for every outcome (success, dismissed, unsupported, no wallet).
 *
 * For most callers this is the only function needed. Use tryAddNftImport directly
 * only when you need to compose custom UX or handle outcomes programmatically.
 */
export function promptAddNft({
  contractAddr,
  tokenId,
  onSuccess,
  delay = 900,
  provider,
  onToast,
}: PromptAddNftOptions): void {
  // ── 1. Validate and normalise tokenId ─────────────────────────────────────
  // BigInt conversion normalises hex ("0x5" → "5") and rejects non-numeric input.
  // MetaMask requires a decimal string — any other type causes a silent rejection.
  let decimalTokenId: string;
  try {
    const n = BigInt(tokenId);
    if (n <= 0n) return; // tokenId 0 = unminted; caller shows appropriate message
    decimalTokenId = n.toString();
  } catch {
    return; // non-parseable; caller shows appropriate message
  }

  // ── 2. Resolve EIP-1193 provider ──────────────────────────────────────────
  // window.ethereum is mandatory. wagmi walletClient.watchAsset() must NOT be used:
  // it serialises tokenId as a JavaScript BigInt (number in JSON) which MetaMask
  // silently rejects (invariant 2).
  const resolvedProvider: NftProvider | null =
    provider !== undefined
      ? provider
      : typeof window !== "undefined" &&
          (window as unknown as { ethereum?: NftProvider }).ethereum
        ? (window as unknown as { ethereum: NftProvider }).ethereum
        : null;

  if (!resolvedProvider) {
    // No EIP-1193 provider — wallet is not installed or not accessible.
    onToast(manualImportInstructions(contractAddr, decimalTokenId), "");
    return;
  }

  // ── 3. Attempt import and map outcome to UX ───────────────────────────────
  const run = async () => {
    const outcome = await tryAddNftImport(resolvedProvider, contractAddr, decimalTokenId);

    switch (outcome.status) {
      case "added":
        onToast("NFT added to MetaMask — check your NFTs tab", "success");
        onSuccess?.();
        break;

      case "dismissed":
        // Wallet processed the request but user clicked Cancel, or the token was already
        // tracked from an earlier automatic prompt. The NFT is in the wallet either way.
        onToast(alreadyTrackedInstructions(contractAddr, decimalTokenId), "success");
        break;

      case "wrong_chain":
        // User explicitly declined the Sepolia switch AND wallet_watchAsset failed.
        // Direct them to switch manually rather than silently dropping the request.
        onToast(wrongChainInstructions(contractAddr, decimalTokenId), "");
        break;

      case "unsupported":
        // wallet_watchAsset threw for both types — this wallet version does not support
        // auto-importing NFTs. Show manual instructions as the fallback.
        onToast(manualImportInstructions(contractAddr, decimalTokenId), "");
        break;
    }
  };

  // ── 4. Execution strategy ─────────────────────────────────────────────────
  //
  // delay > 0 → setTimeout (breaks gesture context — see usage contract above).
  //   Acceptable for automatic post-mint prompts fired from a background receipt
  //   handler where no interactive gesture frame is available. The chain-switch
  //   guard in tryAddNftImport mitigates the most common silent-rejection cause.
  //
  // delay = 0 → execute directly in the caller's async chain.
  //   MetaMask treats wallet_watchAsset as user-initiated as long as the chain
  //   started with eth_requestAccounts inside a gesture frame, even if many awaits
  //   have elapsed since. This is the preferred path for button handlers.
  if (delay > 0) {
    setTimeout(() => { void run(); }, delay);
  } else {
    void run();
  }
}
