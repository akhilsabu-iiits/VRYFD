const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// Chain configurations
const CHAINS = {
  gnosis: {
    name: "Gnosis Chain",
    chainId: 100,
    explorer: "https://gnosisscan.io",
    verify: true,
  },
  polygon: {
    name: "Polygon PoS",
    chainId: 137,
    explorer: "https://polygonscan.com",
    verify: true,
  },
  chiado: {
    name: "Gnosis Chiado Testnet",
    chainId: 10200,
    explorer: "https://gnosis-chiado.blockscout.com",
    verify: true,
  },
  mumbai: {
    name: "Polygon Mumbai Testnet",
    chainId: 80001,
    explorer: "https://mumbai.polygonscan.com",
    verify: true,
  },
  sepolia: {
    name: "Sepolia Testnet",
    chainId: 11155111,
    explorer: "https://sepolia.etherscan.io",
    verify: true,
  },
};

async function deployToChain(chainName) {
  console.log("\n═══════════════════════════════════════════");
  console.log(`  VRYFD Deployment — ${CHAINS[chainName].name}`);
  console.log("═══════════════════════════════════════════\n");

  const baseURI = "ipfs://";
  const deploymentData = {
    chain: chainName,
    chainId: CHAINS[chainName].chainId,
    timestamp: new Date().toISOString(),
    contracts: {},
  };

  try {
    // ── Step 1: Deploy $VRYF Token ──
    console.log("1/3  Deploying $VRYF Token...");
    const VRYFToken = await hre.ethers.getContractFactory("VRYFToken");
    const vryfToken = await VRYFToken.deploy();
    await vryfToken.waitForDeployment();
    const vryfAddress = await vryfToken.getAddress();
    console.log(`     ✓ VRYF Token deployed: ${vryfAddress}`);

    deploymentData.contracts.VRYFToken = {
      address: vryfAddress,
      txHash: vryfToken.deploymentTransaction().hash,
    };

    // ── Step 2: Deploy Attendance Contract ──
    console.log("\n2/3  Deploying VryfdAttendance...");
    const VryfdAttendance = await hre.ethers.getContractFactory("VryfdAttendance");
    const attendance = await VryfdAttendance.deploy(baseURI, vryfAddress);
    await attendance.waitForDeployment();
    const attendanceAddress = await attendance.getAddress();
    console.log(`     ✓ VryfdAttendance deployed: ${attendanceAddress}`);

    deploymentData.contracts.VryfdAttendance = {
      address: attendanceAddress,
      txHash: attendance.deploymentTransaction().hash,
    };

    // ── Step 3: Grant MINTER_ROLE to Attendance contract ──
    console.log("\n3/3  Granting MINTER_ROLE to Attendance contract...");
    const MINTER_ROLE = await vryfToken.MINTER_ROLE();
    const tx = await vryfToken.grantRole(MINTER_ROLE, attendanceAddress);
    await tx.wait();
    console.log("     ✓ MINTER_ROLE granted — Attendance contract can mint $VRYF\n");

    deploymentData.minterRoleTxHash = tx.hash;

    // ── Summary ──
    const blockNumber = await hre.ethers.provider.getBlockNumber();
    deploymentData.blockNumber = blockNumber;

    console.log("═══════════════════════════════════════════");
    console.log("  Deployment Complete!");
    console.log("═══════════════════════════════════════════");
    console.log(`  Network:              ${CHAINS[chainName].name}`);
    console.log(`  Chain ID:             ${CHAINS[chainName].chainId}`);
    console.log(`  VRYF Token:           ${vryfAddress}`);
    console.log(`  VryfdAttendance:      ${attendanceAddress}`);
    console.log(`  Block:                ${blockNumber}`);
    console.log(`  Explorer:             ${CHAINS[chainName].explorer}`);
    console.log("═══════════════════════════════════════════\n");

    // ── Verify on Block Explorer ──
    if (CHAINS[chainName].verify) {
      console.log("Waiting 30s for block explorer indexing...\n");
      await new Promise((r) => setTimeout(r, 30000));

      try {
        console.log("Verifying VRYF Token...");
        await hre.run("verify:verify", {
          address: vryfAddress,
          constructorArguments: [],
        });
        console.log("✓ VRYF Token verified!\n");
        deploymentData.contracts.VRYFToken.verified = true;
      } catch (e) {
        console.log("⚠ VRYF verification note:", e.message, "\n");
        deploymentData.contracts.VRYFToken.verified = false;
        deploymentData.contracts.VRYFToken.verificationError = e.message;
      }

      try {
        console.log("Verifying VryfdAttendance...");
        await hre.run("verify:verify", {
          address: attendanceAddress,
          constructorArguments: [baseURI, vryfAddress],
        });
        console.log("✓ VryfdAttendance verified!\n");
        deploymentData.contracts.VryfdAttendance.verified = true;
      } catch (e) {
        console.log("⚠ Attendance verification note:", e.message, "\n");
        deploymentData.contracts.VryfdAttendance.verified = false;
        deploymentData.contracts.VryfdAttendance.verificationError = e.message;
      }
    }

    deploymentData.success = true;
    return deploymentData;
  } catch (error) {
    console.error(`\n❌ Deployment failed on ${CHAINS[chainName].name}:`, error.message);
    deploymentData.success = false;
    deploymentData.error = error.message;
    return deploymentData;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const chainsToDeployTo = args.length > 0 ? args : [hre.network.name];

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║   VRYFD Multi-Chain Deployment Script    ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`\nDeploying to: ${chainsToDeployTo.join(", ")}\n`);

  const allDeployments = [];

  for (const chainName of chainsToDeployTo) {
    if (!CHAINS[chainName]) {
      console.error(`❌ Unknown chain: ${chainName}`);
      console.log(`Available chains: ${Object.keys(CHAINS).join(", ")}`);
      continue;
    }

    // Deploy to this chain
    const deploymentData = await deployToChain(chainName);
    allDeployments.push(deploymentData);

    // Save individual deployment data
    const deploymentsDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const deploymentFile = path.join(
      deploymentsDir,
      `${chainName}-${Date.now()}.json`
    );
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log(`📄 Deployment data saved to: ${deploymentFile}\n`);
  }

  // ── Generate Deployment Report ──
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║        Multi-Chain Deployment Report      ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  const report = {
    timestamp: new Date().toISOString(),
    deployments: allDeployments,
    summary: {
      total: allDeployments.length,
      successful: allDeployments.filter((d) => d.success).length,
      failed: allDeployments.filter((d) => !d.success).length,
    },
  };

  // Display summary
  allDeployments.forEach((deployment) => {
    const status = deployment.success ? "✓" : "❌";
    console.log(`${status} ${CHAINS[deployment.chain].name} (Chain ID: ${deployment.chainId})`);
    if (deployment.success) {
      console.log(`   VRYF Token:      ${deployment.contracts.VRYFToken.address}`);
      console.log(`   VryfdAttendance: ${deployment.contracts.VryfdAttendance.address}`);
      console.log(`   Explorer:        ${CHAINS[deployment.chain].explorer}`);
    } else {
      console.log(`   Error: ${deployment.error}`);
    }
    console.log();
  });

  // Save comprehensive report
  const reportFile = path.join(
    __dirname,
    "..",
    "deployments",
    `multi-chain-report-${Date.now()}.json`
  );
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`📊 Full report saved to: ${reportFile}\n`);

  // ── Generate Contract Addresses Config ──
  if (report.summary.successful > 0) {
    console.log("═══════════════════════════════════════════");
    console.log("  Contract Addresses for Frontend Config");
    console.log("═══════════════════════════════════════════\n");

    const contractsConfig = {};
    allDeployments
      .filter((d) => d.success)
      .forEach((deployment) => {
        contractsConfig[deployment.chainId] = {
          VryfdAttendance: deployment.contracts.VryfdAttendance.address,
          VRYFToken: deployment.contracts.VRYFToken.address,
        };
      });

    console.log("Add this to frontend/src/config/contracts.ts:\n");
    console.log(JSON.stringify(contractsConfig, null, 2));
    console.log("\n═══════════════════════════════════════════\n");

    // Save contracts config
    const configFile = path.join(
      __dirname,
      "..",
      "deployments",
      "contracts-config.json"
    );
    fs.writeFileSync(configFile, JSON.stringify(contractsConfig, null, 2));
    console.log(`📝 Contracts config saved to: ${configFile}\n`);
  }

  // ── Environment Variables ──
  console.log("═══════════════════════════════════════════");
  console.log("  Environment Variables");
  console.log("═══════════════════════════════════════════\n");
  console.log("Add these to your .env files:\n");

  allDeployments
    .filter((d) => d.success)
    .forEach((deployment) => {
      const chainUpper = deployment.chain.toUpperCase();
      console.log(`# ${CHAINS[deployment.chain].name}`);
      console.log(
        `${chainUpper}_VRYF_TOKEN_ADDRESS=${deployment.contracts.VRYFToken.address}`
      );
      console.log(
        `${chainUpper}_ATTENDANCE_ADDRESS=${deployment.contracts.VryfdAttendance.address}`
      );
      console.log();
    });

  console.log("═══════════════════════════════════════════\n");

  // Exit with appropriate code
  if (report.summary.failed > 0) {
    console.error(`⚠ ${report.summary.failed} deployment(s) failed`);
    process.exit(1);
  } else {
    console.log("✓ All deployments successful!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
