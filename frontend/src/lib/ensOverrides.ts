/**
 * Project-level ENS overrides — maps wallet addresses to ENS names and vice versa.
 * Used when mainnet ENS lookup returns null (e.g. demo wallets without real ENS names).
 */
const ADDRESS_TO_ENS: Record<string, string> = {
  "0x2bc1c93d16dc8e5828eca4a01abd0692dd4c42f6": "akhil.eth",
};

const ENS_TO_ADDRESS: Record<string, string> = {
  "akhil.eth": "0x2bc1c93D16dC8e5828Eca4a01abd0692dd4C42F6",
};

/** Returns the override ENS name for an address, or null if none. */
export function getENSOverride(address: string): string | null {
  return ADDRESS_TO_ENS[address.toLowerCase()] ?? null;
}

/** Returns the override address for an ENS name, or null if none. */
export function getAddressOverride(ensName: string): string | null {
  return ENS_TO_ADDRESS[ensName.toLowerCase()] ?? null;
}
