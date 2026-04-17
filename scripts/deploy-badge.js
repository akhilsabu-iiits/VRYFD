/**
 * Deploy the new VryfdBadge ERC-721 contract and wire it up:
 *   1. Read existing VRYF token + attendance addresses from env
 *   2. Deploy VryfdBadge(attendance, vryfToken)
 *   3. Grant MINTER_ROLE on VRYF token so badge contract can mint +25 VRYF on claim
 *   4. Grant RELAYER_ROLE to the backend relayer wallet so it can submit gasless claims
 *   5. Verify on Etherscan
 *
 * Usage:
 *   npx hardhat run scripts/deploy-badge.js --network sepolia
 *
 * Required env:
 *   PRIVATE_KEY               — deployer (must be the original admin of VRYF token)
 *   SEPOLIA_RPC               — RPC url
 *   NEXT_PUBLIC_CONTRACT_ADDRESS    — existing VryfdAttendance address
 *   NEXT_PUBLIC_VRYF_TOKEN_ADDRESS  — existing VRYF token address
 *   RELAYER_ADDRESS           — backend relayer (same wallet that signs transactions in relayerService)
 */
const hre = require("hardhat");

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VryfdBadge (ERC-721 POAP) Deployment");
  console.log("═══════════════════════════════════════════\n");

  const attendanceAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  const vryfTokenAddress  = process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS;
  const relayerAddress    = process.env.RELAYER_ADDRESS;

  if (!attendanceAddress || !vryfTokenAddress) {
    throw new Error(
      "Missing env vars. Set NEXT_PUBLIC_CONTRACT_ADDRESS (attendance) and NEXT_PUBLIC_VRYF_TOKEN_ADDRESS (VRYF)."
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer:        ${deployer.address}`);
  console.log(`Attendance:      ${attendanceAddress}`);
  console.log(`VRYF Token:      ${vryfTokenAddress}`);
  console.log(`Relayer:         ${relayerAddress || "(not set — skipping RELAYER_ROLE grant)"}`);
  console.log(`Network:         ${hre.network.name}\n`);

  // ── 1. Deploy VryfdBadge ──
  console.log("1/3  Deploying VryfdBadge...");
  const VryfdBadge = await hre.ethers.getContractFactory("VryfdBadge");
  const badge = await VryfdBadge.deploy(attendanceAddress, vryfTokenAddress);
  await badge.waitForDeployment();
  const badgeAddress = await badge.getAddress();
  console.log(`     VryfdBadge deployed: ${badgeAddress}\n`);

  // ── 2. Grant MINTER_ROLE on VRYF token ──
  console.log("2/3  Granting MINTER_ROLE on VRYF Token to Badge contract...");
  const VRYFToken = await hre.ethers.getContractFactory("VRYFToken");
  const vryf = VRYFToken.attach(vryfTokenAddress);
  const MINTER_ROLE = await vryf.MINTER_ROLE();
  const tx = await vryf.grantRole(MINTER_ROLE, badgeAddress);
  await tx.wait();
  console.log(`     MINTER_ROLE granted (tx: ${tx.hash})\n`);

  // ── 3. Grant RELAYER_ROLE on Badge contract to backend relayer ──
  if (relayerAddress) {
    console.log("3/3  Granting RELAYER_ROLE on Badge contract to backend relayer...");
    const RELAYER_ROLE = await badge.RELAYER_ROLE();
    const tx2 = await badge.grantRole(RELAYER_ROLE, relayerAddress);
    await tx2.wait();
    console.log(`     RELAYER_ROLE granted (tx: ${tx2.hash})\n`);
  } else {
    console.log("3/3  Skipped RELAYER_ROLE grant (no RELAYER_ADDRESS env). Run this later:\n");
    console.log(`     badge.grantRole(await badge.RELAYER_ROLE(), <RELAYER_ADDR>)\n`);
  }

  // ── Summary ──
  console.log("═══════════════════════════════════════════");
  console.log("  Deployment Complete");
  console.log("═══════════════════════════════════════════");
  console.log(`  Network:        ${hre.network.name}`);
  console.log(`  VryfdBadge:     ${badgeAddress}`);
  console.log(`  Block:          ${await hre.ethers.provider.getBlockNumber()}`);
  console.log("═══════════════════════════════════════════\n");

  if (hre.network.name === "sepolia") {
    console.log("Waiting 30s for Etherscan indexing...\n");
    await new Promise((r) => setTimeout(r, 30000));
    try {
      await hre.run("verify:verify", {
        address: badgeAddress,
        constructorArguments: [attendanceAddress, vryfTokenAddress],
      });
      console.log("VryfdBadge verified!\n");
    } catch (e) {
      console.log("Badge verification note:", e.message, "\n");
    }
  }

  console.log("Add to backend/.env and frontend/.env.local:");
  console.log(`NEXT_PUBLIC_BADGE_CONTRACT_ADDRESS=${badgeAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
