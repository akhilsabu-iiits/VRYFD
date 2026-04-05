# VRYFD — Decentralized Attendance Verification

> ENS-integrated attendance tracking with soulbound POAPs, milestone NFT rewards, and blockchain-verified certificates on Polygon.

## Quick Start

### Prerequisites
- Node.js 18+
- MetaMask or any WalletConnect-compatible wallet
- Polygon Amoy testnet MATIC (faucet: https://faucet.polygon.technology)
- Pinata account for IPFS (https://pinata.cloud)

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd vryfd-project
npm run install:all
```

### 2. Environment Setup
```bash
cp .env.example .env
# Fill in your keys in .env
```

### 3. Compile & Test Smart Contracts
```bash
npx hardhat compile
npx hardhat test
```

### 4. Deploy to Testnet
```bash
npx hardhat run scripts/deploy.js --network polygonAmoy
# Copy the contract address to .env → NEXT_PUBLIC_CONTRACT_ADDRESS
```

### 5. Copy ABI to Frontend
```bash
cp artifacts/contracts/VryfdAttendance.sol/VryfdAttendance.json frontend/src/abis/
cp artifacts/contracts/VryfdAttendance.sol/VryfdAttendance.json backend/artifacts/
```

### 6. Start Development Servers
```bash
# Terminal 1 — Frontend
cd frontend && npm run dev

# Terminal 2 — Backend
cd backend && npm run dev
```

## Open in VS Code

Open the workspace file for multi-root support with per-role folders:
```
File → Open Workspace from File → vryfd.code-workspace
```

## Project Structure
```
vryfd-project/
├── contracts/              # Solidity smart contracts (Person A)
│   └── VryfdAttendance.sol
├── scripts/                # Deployment scripts
│   └── deploy.js
├── test/                   # Contract tests
│   └── VryfdAttendance.test.js
├── frontend/               # Next.js + wagmi frontend (Person B)
│   └── src/
│       ├── components/     # React components
│       ├── hooks/          # wagmi + ENS hooks
│       ├── utils/          # Config & helpers
│       └── abis/           # Contract ABIs
├── backend/                # Express backend (Person C)
│   └── src/
│       ├── services/       # IPFS, relayer, certificate services
│       └── routes/         # API endpoints
├── .vscode/                # VS Code settings, tasks, launch configs
├── vryfd.code-workspace    # Multi-root workspace
├── hardhat.config.js
└── .env.example
```

## Features

| # | Feature | Contract Function | Frontend | Backend |
|---|---------|------------------|----------|---------|
| 1 | ENS Check-in | `confirmAttendance()` | Wallet connect + ENS resolve | Gasless relay |
| 2 | POAP Badges | `claimBadge()` | Badge gallery | IPFS metadata |
| 3 | Milestone NFTs | `claimMilestoneReward()` | Leaderboard + tiers | Dynamic metadata |
| 4 | Certificates | `issueCertificate()` | Certificate display | QR + verification |

## Team Roles

- **Person A** — Smart contracts, Hardhat, testing, Polygonscan verification
- **Person B** — Frontend, wagmi/RainbowKit, ENS UX, responsive design
- **Person C** — Backend API, IPFS/Pinata, relayer service, certificate generation

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ipfs/upload-image` | Upload badge image to IPFS |
| POST | `/api/ipfs/badge-metadata` | Create & pin POAP metadata |
| POST | `/api/relay/checkin` | Submit gasless check-in signature |
| POST | `/api/relay/flush` | Force-submit batch to chain |
| POST | `/api/certificates/generate` | Generate certificate + QR + IPFS |
| GET | `/api/verify/:id` | Public certificate verification |

## License

MIT
