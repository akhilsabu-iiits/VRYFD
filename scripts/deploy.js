const hre = require("hardhat");

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  VRYFD Deployment — Sepolia Testnet");
  console.log("═══════════════════════════════════════════\n");

  const baseURI = "ipfs://";

  // ── Step 1: Deploy $VRYF Token ──
  console.log("1/3  Deploying $VRYF Token...");
  const VRYFToken = await hre.ethers.getContractFactory("VRYFToken");
  const vryfToken = await VRYFToken.deploy();
  await vryfToken.waitForDeployment();
  const vryfAddress = await vryfToken.getAddress();
  console.log(`     VRYF Token deployed: ${vryfAddress}`);

  // ── Step 2: Deploy Attendance Contract ──
  console.log("\n2/3  Deploying VryfdAttendance...");
  const VryfdAttendance = await hre.ethers.getContractFactory("VryfdAttendance");
  const attendance = await VryfdAttendance.deploy(baseURI, vryfAddress);
  await attendance.waitForDeployment();
  const attendanceAddress = await attendance.getAddress();
  console.log(`     VryfdAttendance deployed: ${attendanceAddress}`);

  // ── Step 3: Grant MINTER_ROLE to Attendance contract ──
  console.log("\n3/3  Granting MINTER_ROLE to Attendance contract...");
  const MINTER_ROLE = await vryfToken.MINTER_ROLE();
  const tx = await vryfToken.grantRole(MINTER_ROLE, attendanceAddress);
  await tx.wait();
  console.log("     MINTER_ROLE granted — Attendance contract can mint $VRYF\n");

  // ── Summary ──
  console.log("═══════════════════════════════════════════");
  console.log("  Deployment Complete!");
  console.log("═══════════════════════════════════════════");
  console.log(`  Network:              ${hre.network.name}`);
  console.log(`  VRYF Token:           ${vryfAddress}`);
  console.log(`  VryfdAttendance:      ${attendanceAddress}`);
  console.log(`  Block:                ${await hre.ethers.provider.getBlockNumber()}`);
  console.log("═══════════════════════════════════════════\n");

  // ── Verify on Etherscan ──
  if (hre.network.name === "sepolia") {
    console.log("Waiting 30s for Etherscan indexing...\n");
    await new Promise((r) => setTimeout(r, 30000));

    try {
      console.log("Verifying VRYF Token...");
      await hre.run("verify:verify", {
        address: vryfAddress,
        constructorArguments: [],
      });
      console.log("VRYF Token verified!\n");
    } catch (e) {
      console.log("VRYF verification note:", e.message, "\n");
    }

    try {
      console.log("Verifying VryfdAttendance...");
      await hre.run("verify:verify", {
        address: attendanceAddress,
        constructorArguments: [baseURI, vryfAddress],
      });
      console.log("VryfdAttendance verified!\n");
    } catch (e) {
      console.log("Attendance verification note:", e.message, "\n");
    }
  }

  // ── Output for .env ──
  console.log("Add these to your .env file:");
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${attendanceAddress}`);
  console.log(`NEXT_PUBLIC_VRYF_TOKEN_ADDRESS=${vryfAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
