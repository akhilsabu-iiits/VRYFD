/**
 * Project-level ENS overrides — maps wallet addresses to ENS names and vice versa.
 * Used when mainnet ENS lookup returns null (e.g. demo wallets without real ENS names).
 */
const ADDRESS_TO_ENS = {
  "0x2bc1c93d16dc8e5828eca4a01abd0692dd4c42f6": "akhil.eth",
};

const ENS_TO_ADDRESS = {
  "akhil.eth": "0x2bc1c93D16dC8e5828Eca4a01abd0692dd4C42F6",
};

/** Returns the override ENS name for an address, or null if none. */
function getENSOverride(address) {
  return ADDRESS_TO_ENS[address.toLowerCase()] ?? null;
}

/** Returns the override address for an ENS name, or null if none. */
function getAddressOverride(ensName) {
  return ENS_TO_ADDRESS[ensName.toLowerCase()] ?? null;
}

module.exports = { getENSOverride, getAddressOverride };
