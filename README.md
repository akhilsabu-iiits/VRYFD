<div align="center">


# VRYFD

### On-Chain Event Attendance System

*Verify presence. Earn rewards. Own your record — forever on the blockchain.*

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square&logo=solidity)](https://soliditylang.org)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.x-yellow?style=flat-square&logo=hardhat)](https://hardhat.org)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.x-4869CA?style=flat-square&logo=openzeppelin&logoColor=white)](https://openzeppelin.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io)
[![IPFS](https://img.shields.io/badge/IPFS-Pinata-65C2CB?style=flat-square&logo=ipfs&logoColor=white)](https://ipfs.tech)

<br/>

<table>
<tr>
<td align="center"><b>⚡ Gasless</b><br/>Zero gas cost to users</td>
<td align="center"><b>🔴 Live Sessions</b><br/>WebRTC real-time tracking</td>
<td align="center"><b>🏅 Soulbound NFTs</b><br/>Non-transferable POAPs</td>
<td align="center"><b>🌐 Multi-Chain</b><br/>Gnosis · Polygon · Sepolia</td>
</tr>
</table>

<br/>

</div>

---

## What is VRYFD?

VRYFD is a Web3 platform for verifiable event attendance. Every check-in is recorded on-chain, gasless. Attendees earn soulbound POAP badges, ERC-20 VRYF tokens, milestone NFTs, and tamper-proof certificates — automatically, with zero gas cost to the user.

---

## ✨ Features

| | Feature | Description |
|:---:|---|---|
| ⚡ | **Gasless Check-In** | EIP-712 signed messages — the relayer pays all on-chain gas |
| 🔴 | **Live Session Tracking** | WebRTC + Socket.io tracks webinar attendance duration in real time |
| 🏅 | **Soulbound POAP Badges** | Non-transferable ERC-1155 NFT issued per event attended |
| 🪙 | **VRYF Token Rewards** | ERC-20 tokens auto-minted for check-ins, badges, and milestones |
| 🏆 | **Milestone NFTs** | Bronze / Silver / Gold at 5 / 10 / 20 events attended |
| 📜 | **Blockchain Certificates** | Tamper-proof certificates with scannable QR codes |
| 📊 | **ENS Leaderboard** | Ranked board with `.eth` name resolution |
| 🛠️ | **Organizer Dashboard** | Create events, approve joins, monitor live sessions, bulk-issue certs |
| 🌐 | **Multi-Chain** | Gnosis Chain, Polygon, Sepolia — backend auto-detects configured networks |
| 🔐 | **Tamper-Proof Records** | On-chain attendance — no central authority can alter it |

---

## 🪙 VRYF Token Rewards

> Tokens are auto-minted on-chain — no manual claiming required.

| Action | Reward |
|---|:---:|
| ✅ Check-in confirmed on-chain | **`+10 VRYF`** |
| 🏅 POAP Badge claimed | **`+25 VRYF`** |
| 🥉 Bronze milestone — 5 events | **`+100 VRYF`** |
| 🥈 Silver milestone — 10 events | **`+250 VRYF`** |
| 🥇 Gold milestone — 20 events | **`+500 VRYF`** |

---

## ⚙️ How It Works

```
  👛  Connect wallet (MetaMask / WalletConnect)
       │
  🗓️  Browse Marketplace → select an event
       │
  🔑  Enter 6-digit join code  ──or──  join live session via WebRTC
       │
  ✍️  Sign EIP-712 message                   ← zero gas cost to user
       │
  ⛓️  Relayer submits transaction on-chain   ← backend pays gas
       │
  ✅  Organizer confirms / approves attendance
       │
  🏅  Claim POAP Badge  →  earn VRYF tokens
       │
  🏆  Milestone NFTs unlock at 5 / 10 / 20 events
       │
  📜  Organizer bulk-issues QR-verified certificates
```

---

## 🏗️ Tech Stack

<table>
<tr><th>Layer</th><th>Technology</th></tr>
<tr><td>⛓️ <b>Smart Contracts</b></td><td>Solidity 0.8.24 · Hardhat · OpenZeppelin</td></tr>
<tr><td>🖥️ <b>Frontend</b></td><td>Next.js 14 · TypeScript · Tailwind CSS</td></tr>
<tr><td>🔗 <b>Web3</b></td><td>wagmi v2 · RainbowKit · ethers.js v6</td></tr>
<tr><td>🖧 <b>Backend</b></td><td>Node.js · Express · Socket.io</td></tr>
<tr><td>📡 <b>Real-Time</b></td><td>WebRTC (P2P) · Socket.io signaling</td></tr>
<tr><td>🗄️ <b>Database</b></td><td>MongoDB</td></tr>
<tr><td>📦 <b>NFT Storage</b></td><td>IPFS via Pinata</td></tr>
<tr><td>🌐 <b>Networks</b></td><td>Gnosis Chain · Polygon PoS · Sepolia · Chiado</td></tr>
<tr><td>👛 <b>Wallet</b></td><td>MetaMask · WalletConnect</td></tr>
</table>

---

## ⛓️ Supported Networks

| Network | Chain ID | Type |
|---|:---:|---|
| 🦉 **Gnosis Chain** | `100` | Mainnet — Primary |
| 🟣 **Polygon PoS** | `137` | Mainnet — Secondary |
| 🔵 **Ethereum Sepolia** | `11155111` | Testnet |
| 🟡 **Gnosis Chiado** | `10200` | Testnet |

---

## 🚀 Local Development

### Prerequisites

- Node.js 18+
- MongoDB (local or [Atlas](https://www.mongodb.com/atlas))
- MetaMask browser extension

### 1. Clone & Install

```bash
git clone -b DemoReady https://github.com/akhilsabu-iiits/VRYFD.git
cd VRYFD
npm run install:all
```

### 2. Configure Environment

```bash
cp backend/.env.example backend/.env
```

Minimum required for local development:

```env
NODE_ENV=development
PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/vryfd
ADMIN_SECRET=your-local-secret

# Blockchain (Sepolia)
PRIVATE_KEY=                           # Relayer wallet private key
SEPOLIA_ATTENDANCE_ADDRESS=            # Deployed contract address
SEPOLIA_VRYF_TOKEN_ADDRESS=            # Deployed token address
BACKEND_RELAYER_PRIVATE_KEY=           # Wallet that pays gas for check-ins

# IPFS
PINATA_API_KEY=
PINATA_SECRET_API_KEY=

NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### 3. Run

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

| Service | URL |
|---|---|
| 🌐 Frontend | http://localhost:3000 |
| 🖥️ Backend API | http://localhost:3001 |

---

## 📦 Contract Deployment

```bash
# Sepolia testnet
npm run deploy:testnet

# Gnosis Chain (mainnet)
npx hardhat run scripts/deploy.js --network gnosis

# Polygon (mainnet)
npx hardhat run scripts/deploy.js --network polygon
```

> After deployment, copy the printed contract addresses into `backend/.env`.

---

<div align="center">

**MIT License** · Built with ❤️ on Gnosis Chain · Polygon · Ethereum Sepolia

</div>
