/**
 * Grants MINTER_ROLE on the VRYF token to the VryfdBadge contract so that
 * every POAP claim also pays out +25 VRYF to the attendee.
 *
 * MUST be run by the wallet that holds DEFAULT_ADMIN_ROLE on the VRYF token —
 * this is the wallet that originally deployed the token. If that is NOT the
 * same as your backend relayer wallet, temporarily set ADMIN_PRIVATE_KEY in
 * your env and run:
 *
 *     $env:ADMIN_PRIVATE_KEY = "0x..."
 *     npx hardhat run scripts/grant-badge-minter.js --network sepolia
 *
 * Idempotent — re-runs are safe (the grantRole call is a no-op if already granted).
 */
const hre = require("hardhat");

async function main() {
  const vryfTokenAddress  = process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS;
  const badgeAddress      = process.env.NEXT_PUBLIC_BADGE_CONTRACT_ADDRESS;
  const adminKey          = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;

  if (!vryfTokenAddress || !badgeAddress) {
    throw new Error("Missing NEXT_PUBLIC_VRYF_TOKEN_ADDRESS or NEXT_PUBLIC_BADGE_CONTRACT_ADDRESS in .env");
  }
  if (!adminKey) {
    throw new Error("Missing ADMIN_PRIVATE_KEY / PRIVATE_KEY for the admin wallet");
  }

  const provider = new hre.ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC || "https://rpc.sepolia.org"
  );
  const normalized = adminKey.startsWith("0x") ? adminKey : "0x" + adminKey;
  const admin = new hre.ethers.Wallet(normalized, provider);

  console.log("Admin wallet :", admin.address);
  console.log("VRYF token   :", vryfTokenAddress);
  console.log("Badge        :", badgeAddress);

  const vryfAbi = [
    "function MINTER_ROLE() view returns (bytes32)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function grantRole(bytes32,address) external",
  ];
  const vryf = new hre.ethers.Contract(vryfTokenAddress, vryfAbi, admin);

  const [MINTER_ROLE, DEFAULT_ADMIN_ROLE] = await Promise.all([
    vryf.MINTER_ROLE(),
    vryf.DEFAULT_ADMIN_ROLE(),
  ]);

  const isAdmin = await vryf.hasRole(DEFAULT_ADMIN_ROLE, admin.address);
  if (!isAdmin) {
    throw new Error(
      `${admin.address} does not hold DEFAULT_ADMIN_ROLE on VRYF ${vryfTokenAddress}. ` +
      "Use the wallet that originally deployed the token."
    );
  }

  const alreadyMinter = await vryf.hasRole(MINTER_ROLE, badgeAddress);
  if (alreadyMinter) {
    console.log("Badge already has MINTER_ROLE — nothing to do.");
    return;
  }

  console.log("Granting MINTER_ROLE to badge contract...");
  const tx = await vryf.grantRole(MINTER_ROLE, badgeAddress);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Done — badge contract can now mint +25 VRYF on each POAP claim.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
