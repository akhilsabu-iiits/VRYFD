/**
 * Tests for promptAddNft — guards the exact invariants that caused the MetaMask popup
 * to silently disappear when broken. Every test here maps to a real regression.
 *
 * Run: npm test (from frontend/)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promptAddNft, type NftProvider } from "../promptAddNft";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(returnValue: boolean | Error = true): {
  provider: NftProvider;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  const provider: NftProvider = {
    request: vi.fn(async (args) => {
      calls.push(args);
      if (returnValue instanceof Error) throw returnValue;
      return returnValue;
    }),
  };
  return { provider, calls };
}

function makeToast() {
  const messages: Array<{ msg: string; type: string }> = [];
  const onToast = vi.fn((msg: string, type: "success" | "") => messages.push({ msg, type }));
  return { onToast, messages };
}

// ─── Core invariants ─────────────────────────────────────────────────────────

describe("promptAddNft — tokenId format", () => {
  it("sends tokenId as a decimal string, not a number or BigInt", async () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "5", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); // flush microtasks

    const opts = (calls[0].params as { options: { tokenId: unknown } }).options;
    expect(typeof opts.tokenId).toBe("string");
    expect(opts.tokenId).toBe("5");
    vi.useRealTimers();
  });

  it("converts hex tokenId to decimal string", async () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "0x5", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve();

    const opts = (calls[0].params as { options: { tokenId: unknown } }).options;
    expect(opts.tokenId).toBe("5");
    vi.useRealTimers();
  });

  it("converts large numeric string to decimal string", async () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "1000000000000000000", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve();

    const opts = (calls[0].params as { options: { tokenId: unknown } }).options;
    expect(opts.tokenId).toBe("1000000000000000000");
    vi.useRealTimers();
  });
});

describe("promptAddNft — token validation", () => {
  it("does nothing for tokenId '0'", () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "0", provider, onToast, delay: 0 });
    vi.runAllTimers();

    expect(calls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("does nothing for tokenId '0x0'", () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "0x0", provider, onToast, delay: 0 });
    vi.runAllTimers();

    expect(calls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("does nothing for non-parseable tokenId", () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "not-a-number", provider, onToast, delay: 0 });
    vi.runAllTimers();

    expect(calls).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("promptAddNft — provider usage", () => {
  it("uses the injected provider (window.ethereum equivalent), NOT wagmi watchAsset", async () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    // The provider injected here is the window.ethereum stand-in.
    // If the code used wagmi walletClient.watchAsset() it would NOT call provider.request().
    promptAddNft({ contractAddr: "0xABC", tokenId: "3", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].method).toBe("wallet_watchAsset");
    vi.useRealTimers();
  });

  it("shows fallback toast when no provider is available", () => {
    vi.useFakeTimers();
    const { onToast, messages } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "3", provider: null, onToast, delay: 0 });
    vi.runAllTimers();

    expect(messages[0].msg).toContain("Import NFT");
    expect(messages[0].msg).toContain("Token ID: 3");
    vi.useRealTimers();
  });
});

describe("promptAddNft — ERC type ordering", () => {
  it("tries ERC1155 before ERC721", async () => {
    vi.useFakeTimers();
    // Provider returns false so both types get tried
    const { provider, calls } = makeProvider(false);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "7", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); // flush both async tries

    const types = calls.map((c) => (c.params as { type: string }).type);
    expect(types[0]).toBe("ERC1155");
    expect(types[1]).toBe("ERC721");
    vi.useRealTimers();
  });

  it("stops at ERC1155 when it succeeds — does not send ERC721", async () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true); // true = user clicked Add
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "7", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect((calls[0].params as { type: string }).type).toBe("ERC1155");
    vi.useRealTimers();
  });

  it("falls through to ERC721 when ERC1155 throws", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const calls: Array<{ method: string; params: unknown }> = [];
    const provider: NftProvider = {
      request: vi.fn(async (args) => {
        calls.push(args);
        callCount++;
        if (callCount === 1) throw new Error("ERC1155 not supported");
        return true; // ERC721 succeeds
      }),
    };
    const { onToast, messages } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "7", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect((calls[0].params as { type: string }).type).toBe("ERC1155");
    expect((calls[1].params as { type: string }).type).toBe("ERC721");
    expect(messages[0].msg).toContain("NFT added to MetaMask");
    vi.useRealTimers();
  });

  it("shows fallback toast when both ERC1155 and ERC721 fail", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider(new Error("not supported"));
    const { onToast, messages } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "9", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(messages[0].msg).toContain("Import NFT");
    expect(messages[0].msg).toContain("Token ID: 9");
    vi.useRealTimers();
  });

  it("shows fallback toast when both ERC1155 and ERC721 return false (user dismissed)", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider(false);
    const { onToast, messages } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "9", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(messages[0].msg).toContain("Import NFT");
    vi.useRealTimers();
  });
});

describe("promptAddNft — delay", () => {
  it("default delay is 900ms (MetaMask RPC propagation window)", () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "2", provider, onToast });

    // At 899ms nothing should have fired
    vi.advanceTimersByTime(899);
    expect(calls).toHaveLength(0);

    // At 900ms it fires
    vi.advanceTimersByTime(1);
    expect(calls.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("respects a custom delay", () => {
    vi.useFakeTimers();
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: "0xABC", tokenId: "2", provider, onToast, delay: 2000 });

    vi.advanceTimersByTime(1999);
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(calls.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

describe("promptAddNft — success callback", () => {
  it("calls onSuccess when MetaMask confirms the add", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider(true);
    const { onToast } = makeToast();
    const onSuccess = vi.fn();

    promptAddNft({ contractAddr: "0xABC", tokenId: "4", provider, onToast, onSuccess, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does NOT call onSuccess when user dismisses", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider(false);
    const { onToast } = makeToast();
    const onSuccess = vi.fn();

    promptAddNft({ contractAddr: "0xABC", tokenId: "4", provider, onToast, onSuccess, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(onSuccess).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("promptAddNft — post-Reset contract address", () => {
  /**
   * After the organizer clicks Reset, contracts are redeployed to a NEW address.
   * The badge/milestone claim flow fetches the live contract address from the backend
   * nonce endpoint (signingContractAddress) and MUST pass that — not the stale
   * CONTRACT_ADDRESSES[chainId] — to promptAddNft. These tests guard that invariant.
   */

  it("sends the exact contractAddr passed in — does not use a hardcoded or cached address", async () => {
    vi.useFakeTimers();
    const newContractAddr = "0xNEWCONTRACTAFTERRESET1234567890abcdef";
    const { provider, calls } = makeProvider(true);
    const { onToast } = makeToast();

    promptAddNft({ contractAddr: newContractAddr, tokenId: "1", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve();

    const opts = (calls[0].params as { options: { address: string } }).options;
    expect(opts.address).toBe(newContractAddr);
    vi.useRealTimers();
  });

  it("works correctly when called with a different address after Reset", async () => {
    vi.useFakeTimers();
    const oldAddr = "0xOLD000000000000000000000000000000000000";
    const newAddr = "0xNEW000000000000000000000000000000000000";
    const { onToast, messages } = makeToast();

    // Simulate pre-reset claim
    const { provider: p1, calls: calls1 } = makeProvider(true);
    promptAddNft({ contractAddr: oldAddr, tokenId: "1", provider: p1, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve();
    expect((calls1[0].params as { options: { address: string } }).options.address).toBe(oldAddr);

    // Simulate post-reset claim — new address, same tokenId (fresh mint on new contract)
    vi.useFakeTimers();
    const { provider: p2, calls: calls2 } = makeProvider(true);
    promptAddNft({ contractAddr: newAddr, tokenId: "1", provider: p2, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve();
    expect((calls2[0].params as { options: { address: string } }).options.address).toBe(newAddr);

    // Both should have succeeded
    expect(messages.filter((m) => m.msg.includes("NFT added"))).toHaveLength(2);
    vi.useRealTimers();
  });

  it("fallback toast shows the correct new contract address after Reset", async () => {
    vi.useFakeTimers();
    const newAddr = "0xNEWCONTRACTABC123456789";
    const { provider } = makeProvider(new Error("wallet_watchAsset not supported"));
    const { onToast, messages } = makeToast();

    promptAddNft({ contractAddr: newAddr, tokenId: "5", provider, onToast, delay: 0 });
    vi.runAllTimers();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(messages[0].msg).toContain(newAddr.slice(0, 8));
    vi.useRealTimers();
  });
});
