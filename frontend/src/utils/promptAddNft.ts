/**
 * promptAddNft — fires wallet_watchAsset to prompt MetaMask to import a newly minted NFT.
 *
 * CRITICAL INVARIANTS — do not change without running the test suite:
 *   1. tokenId MUST be sent as a decimal string (MetaMask rejects numeric / BigInt / hex).
 *   2. window.ethereum is used directly — NOT wagmi walletClient.watchAsset() which passes
 *      tokenId as a BigInt in JSON, causing MetaMask to silently reject the request.
 *   3. ERC1155 is tried first (MetaMask v11.7+), ERC721 is the fallback.
 *   4. Default delay is 900ms — gives MetaMask's RPC (Infura) time to propagate the mined
 *      block before we ask it to verify the token. Without this MetaMask silently rejects.
 *   5. Token must be confirmed on-chain BEFORE calling this function. Caller is responsible.
 *
 * If any invariant breaks, the MetaMask popup silently disappears and users see only the
 * fallback toast. The test suite in __tests__/promptAddNft.test.ts guards all of these.
 */
export interface NftProvider {
  request: (args: { method: string; params: unknown }) => Promise<unknown>;
}

export interface PromptAddNftOptions {
  /** Contract address of the NFT collection */
  contractAddr: string;
  /** Token ID — decimal string, hex string, or numeric string. Converted to decimal internally. */
  tokenId: string;
  /** Called only when MetaMask confirmed the add (wallet_watchAsset returned true). */
  onSuccess?: () => void;
  /** Ms to wait before sending wallet_watchAsset. Default: 900. */
  delay?: number;
  /** Override the EIP-1193 provider. Defaults to window.ethereum. For testing only. */
  provider?: NftProvider | null;
  /** Callback for success/fallback toast messages. */
  onToast: (msg: string, type: "success" | "") => void;
}

export function promptAddNft({
  contractAddr,
  tokenId,
  onSuccess,
  delay = 900,
  provider,
  onToast,
}: PromptAddNftOptions): void {
  // Validate and normalise tokenId to decimal string
  let decimalTokenId: string;
  try {
    const n = tokenId.startsWith("0x") ? BigInt(tokenId) : BigInt(tokenId);
    if (n <= 0n) return; // tokenId 0 means unminted — do nothing
    decimalTokenId = n.toString();
  } catch {
    return; // non-parseable tokenId — do nothing
  }

  // Resolve provider: window.ethereum is required. wagmi walletClient must NOT be used here
  // because it serialises tokenId as a BigInt (number in JSON) instead of a decimal string.
  const resolvedProvider: NftProvider | null =
    provider !== undefined
      ? provider
      : typeof window !== "undefined" && (window as unknown as { ethereum?: NftProvider }).ethereum
        ? (window as unknown as { ethereum: NftProvider }).ethereum
        : null;

  const showFallbackToast = () =>
    onToast(
      `NFT minted ✓  To add: MetaMask → NFTs tab → Import NFT → Contract: ${contractAddr.slice(0, 8)}… Token ID: ${decimalTokenId}`,
      ""
    );

  if (!resolvedProvider) {
    showFallbackToast();
    return;
  }

  const tryWatch = (type: string): Promise<boolean> =>
    resolvedProvider.request({
      method: "wallet_watchAsset",
      params: { type, options: { address: contractAddr, tokenId: decimalTokenId } },
    }) as Promise<boolean>;

  setTimeout(async () => {
    try {
      // ERC1155 first (MetaMask v11.7+)
      const added = await tryWatch("ERC1155");
      if (added) { onToast("NFT added to MetaMask — check your NFTs tab", "success"); onSuccess?.(); return; }
    } catch { /* ERC1155 not supported by this wallet version */ }

    try {
      // ERC721 fallback — MetaMask handles ERC-1155 tokens with this type on older versions
      const added = await tryWatch("ERC721");
      if (added) { onToast("NFT added to MetaMask — check your NFTs tab", "success"); onSuccess?.(); return; }
    } catch { /* ERC721 also failed */ }

    showFallbackToast();
  }, delay);
}
