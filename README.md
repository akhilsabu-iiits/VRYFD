# <img src="frontend/public/favicon.svg" width="32" height="32" align="center" /> On-Chain Event Attendance System (VRYFD)

> A decentralized event attendance platform that enables participants to verify their attendance on-chain and earn VRYF tokens for verified participation.

---

## Screenshots

| Landing Page | Dashboard |
| --- | --- |
| <img src="docs/Screenshots/VRYFD.png" width="400" height="225"/> | <img src="docs/Screenshots/Dashboard.jpg" width="400" height="225"/> |

| Events | Leaderboard |
| --- | --- |
| <img src="docs/Screenshots/Events.png" width="400" height="225"/> | <img src="docs/Screenshots/Leaderboard.png" width="400" height="225"/> |

| VRYF Tokens | Certificates |
| --- | --- |
| <img src="docs/Screenshots/VRYF Token.png" width="400" height="225"/> | <img src="docs/Screenshots/Certificate.png" width="400" height="225"/> |

---

## Features

- **Gasless Check-In** — Sign with your wallet, zero gas fees. The relayer pays all on-chain costs.
- **POAP Badges** — Soulbound ERC-1155 NFT for every event attended. Non-transferable proof of presence.
- **VRYF Token Rewards** — Earn ERC-20 tokens for check-ins, badges, and milestone achievements.
- **Milestone NFTs** — Bronze, Silver, and Gold tier NFTs unlocked at 5, 10, and 20 events.
- **Blockchain Certificates** — Tamper-proof certificates with QR codes for instant public verification.
- **Leaderboard** — Ranked attendance board with ENS name resolution.
- **Organizer Dashboard** — Deploy events, generate join codes, confirm attendees, issue certificates.
- **Tamper-Proof Records** — Every check-in lives on-chain. No central authority can alter it.

---

## VRYF Token Rewards

| Action | Reward |
| --- | --- |
| Check-in confirmed | +10 VRYF |
| POAP Badge claimed | +25 VRYF |
| Bronze milestone (5 events) | +100 VRYF |
| Silver milestone (10 events) | +250 VRYF |
| Gold milestone (20 events) | +500 VRYF |

---

## How It Works

```
Attendee connects wallet
        |
Selects an event
        |
Enters 6-digit join code
        |
Signs EIP-712 message  <-- zero gas cost
        |
Relayer submits on-chain tx  <-- backend pays gas
        |
Organizer confirms attendance
        |
Attendee claims POAP Badge --> earns VRYF tokens
        |
Milestone NFTs unlock at 5 / 10 / 20 events
        |
Organizer issues verifiable certificate with QR code
```

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Smart Contracts | Solidity, Hardhat, OpenZeppelin ERC-1155 |
| Frontend | Next.js 14, TypeScript, wagmi v2, RainbowKit |
| Backend | Node.js, Express, ethers.js v6 |
| Database | MongoDB |
| Storage | IPFS via Pinata |
| Network | Ethereum Sepolia Testnet |
| Wallet | MetaMask, WalletConnect |

---

## Local Development

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- Sepolia testnet ETH — [sepoliafaucet.com](https://sepoliafaucet.com)

### Setup

```bash
git clone https://github.com/akhilsabu-iiits/VRYFD.git
cd VRYFD
npm install
cd frontend && npm install
cd ../backend && npm install
```

```bash
cp .env.example .env
```

```env
PRIVATE_KEY=                          # Relayer wallet private key
NEXT_PUBLIC_CONTRACT_ADDRESS=         # Deployed contract address
ALCHEMY_API_KEY=                      # RPC provider
MONGODB_URI=                          # MongoDB connection string
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID= # WalletConnect project ID
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### Run

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Documentation

| Document | Description |
| --- | --- |
| [High-Level Documentation](docs/VRYFD_High_Level_Documentation.pdf) | Architecture, features, workflows, security model, and design patterns |
| [Setup & Run Guide](docs/VRYFD_Setup_Guide.pdf) | Step-by-step instructions to set up, compile, deploy, and run the project |

---

## License

MIT

---
---

## High-Level Documentation

---

### 1. Project Overview

VRYFD (pronounced *Verified*) is a decentralized event attendance and certification platform built on the Ethereum blockchain. It replaces traditional paper certificates and easily editable PDFs with tamper-proof, blockchain-anchored digital credentials that anyone can verify in seconds.

The platform runs on the **Sepolia testnet**, meaning all interactions use free test ETH with zero monetary risk. Every check-in, badge, certificate, and token reward is recorded on-chain, creating a permanent and publicly auditable record of participation.

> VRYFD transforms event attendance from an easily forged claim into a cryptographically verifiable fact. Attendees build a portable, trustless credential portfolio. Organizers eliminate fake attendance. Employers and institutions can verify claims instantly via QR code.

---

### 2. Problem Statement

Current event participation systems suffer from fundamental trust and efficiency problems:

- **Certificate Fraud** — PDF and image-based certificates can be trivially forged or edited, undermining the credibility of legitimate achievements.
- **Verification Bottleneck** — Employers and institutions have no reliable, automated way to confirm whether a candidate actually attended an event or earned a credential.
- **Manual Inefficiency** — Traditional attendance systems rely on sign-in sheets, manual headcounts, or honor-based reporting, all of which are error-prone and exploitable.
- **No Portability** — Credentials are siloed within individual platforms and cannot be independently verified outside the issuing organization's ecosystem.

---

### 3. Solution

VRYFD addresses these challenges through a blockchain-native approach:

- **Soulbound digital badges** (non-transferable NFTs) that serve as tamper-proof proof of attendance
- **On-chain attendance records** creating permanent, immutable participation history
- **Public verification via QR codes** enabling anyone to confirm credential authenticity in seconds
- **Gamified engagement** through milestone NFT rewards and a platform token ($VRYF)
- **ENS identity integration** replacing cryptic wallet addresses with human-readable names
- **Gasless check-in** via EIP-712 signatures so attendees never pay transaction fees

---

### 4. System Architecture

VRYFD follows a three-layer architecture with the blockchain as the ultimate source of truth:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Smart Contracts (On-Chain) | Solidity, ERC-1155 + ERC-20 | Attendance records, soulbound badges, milestone NFTs, certificates, VRYF tokens |
| Backend Relayer | Node.js / Express | Gas-paying relayer, join code validation, EIP-712 signature verification, IPFS uploads |
| Frontend | Next.js (TypeScript), wagmi + RainbowKit | Wallet connection, event browsing, check-in UI, badge/cert management |
| Storage | IPFS via Pinata, JSON file cache | Badge/certificate metadata & images, server-side state persistence |

The backend acts as a **trusted relayer** holding `ORGANIZER_ROLE` and `RELAYER_ROLE` on the smart contract. It pays gas on behalf of users for check-ins and confirmations, ensuring a frictionless attendee experience. All critical state ultimately lives on-chain.

---

### 5. Core Features

#### 5.1 ENS-Verified Identity

VRYFD integrates with the Ethereum Name Service to replace wallet addresses with human-readable names (e.g., `alice.eth`). ENS names are resolved against Ethereum mainnet and displayed on leaderboards, certificates, and attendance records. ENS is optional; all features work with a plain wallet address.

#### 5.2 Soulbound POAP Badges

Each confirmed attendance earns the attendee a Proof of Attendance Protocol (POAP) badge implemented as a soulbound ERC-1155 token. These badges cannot be sold, transferred, or given away, ensuring they represent genuine personal participation. Badge metadata (event name, date, image) is stored on IPFS for permanence even if the platform goes offline.

#### 5.3 Milestone NFT Rewards

A three-tier gamification system rewards consistent engagement with collectible milestone NFTs:

| Tier | Threshold | Reward |
| --- | --- | --- |
| Bronze Explorer | 5 events | Bronze NFT + 100 VRYF |
| Silver Pioneer | 10 events | Silver NFT + 250 VRYF |
| Gold Legend | 20 events | Gold NFT + 500 VRYF |

Milestone NFTs are also soulbound and claimed manually by the attendee when their event count crosses each threshold.

#### 5.4 Blockchain Certificates

After an event ends, organizers issue time-stamped certificates anchored to the blockchain. Each certificate contains a unique ID, the attendee's wallet/ENS, an issue timestamp, and a QR code linking to a public verification page. Certificates can be shared on LinkedIn, downloaded as PNGs, or verified by scanning the QR code. Organizers can revoke certificates if issued in error, and revocation status is publicly visible.

---

### 6. User Workflow

#### 6.1 End-to-End Attendee Flow

| Step | Action | Details |
| --- | --- | --- |
| 1 | Connect Wallet | MetaMask or WalletConnect on Sepolia testnet |
| 2 | Enter Join Code | 6-character code displayed by organizer at the venue |
| 3 | Organizer Confirms | Organizer verifies physical presence and confirms on-chain |
| 4 | Claim POAP Badge | Soulbound ERC-1155 minted to wallet (+25 VRYF) |
| 5 | Earn Milestones | Bronze/Silver/Gold NFTs unlocked at 5/10/20 events |
| 6 | Receive Certificate | Organizer issues time-stamped, QR-verifiable certificate |
| 7 | Share & Verify | Download, post on LinkedIn, or scan QR for public verification |

#### 6.2 Organizer Flow

| Step | Action | Details |
| --- | --- | --- |
| 1 | Create Event | Name, emoji, color, start/end dates via organizer dashboard |
| 2 | Deploy On-Chain | Smart contract records event; join code generated automatically |
| 3 | Share Join Code | Display at venue via slides, whiteboard, or printed cards |
| 4 | Confirm Attendees | Review pending list; confirm individually or batch-confirm all |
| 5 | Issue Certificates | Bulk-issue to all confirmed attendees after event ends |
| 6 | Manage & Revoke | Edit events mid-flight; revoke certificates if needed |

#### 6.3 Verification Flow

Any third party (employer, school, institution) can verify a VRYFD certificate without an account or wallet. They scan the certificate's QR code, which opens a public verification page reading directly from the smart contract. The page displays event name, attendee identity, timestamp, and valid/revoked status, with a link to the raw Etherscan transaction.

---

### 7. Technology Stack

| Category | Technology | Purpose |
| --- | --- | --- |
| Blockchain | Ethereum (Sepolia Testnet) | On-chain state and transaction execution |
| Smart Contracts | Solidity (ERC-1155 + ERC-20) | Attendance, badges, milestones, certs, tokens |
| Development Framework | Hardhat | Contract compilation, testing, and deployment |
| Backend | Node.js / Express | Relayer service, API routes, IPFS uploads |
| Signatures | EIP-712 Typed Data | Gasless, replay-proof check-in signatures |
| Frontend | Next.js 13+ (TypeScript) | Server-side rendering, app router |
| Wallet Integration | wagmi + viem + RainbowKit | Wallet connection, on-chain reads/writes |
| Decentralized Storage | IPFS via Pinata | Badge/certificate metadata and images |
| Blockchain Interaction | ethers.js | Contract calls from backend relayer |
| Identity | ENS (Ethereum Name Service) | Human-readable wallet identities |
| Block Explorer | Etherscan (Sepolia) | Transaction verification and auditing |

---

### 8. Smart Contract Architecture

VRYFD uses two primary smart contracts deployed on Sepolia.

#### 8.1 VryfdAttendance.sol

The core contract handling events, attendance records, soulbound badges, milestone NFTs, and certificate issuance. It implements ERC-1155 for multi-token support with a custom `_update()` override that blocks all transfers except minting and burning, enforcing the soulbound property.

**Role-Based Access Control**

| Role | Capabilities | Held By |
| --- | --- | --- |
| `ORGANIZER_ROLE` | Create events, confirm attendance, issue/revoke certificates, set milestone URIs | Relayer wallet |
| `RELAYER_ROLE` | Submit gasless check-ins, batch confirmations | Relayer wallet |

**Key Contract Functions**

| Category | Function | Description |
| --- | --- | --- |
| Events | `createEvent()` | Creates event + soulbound badge token ID |
| Attendance | `checkInFor()` | Organizer confirms physical presence on-chain |
| Attendance | `confirmAttendanceGasless()` | Relayer submits EIP-712 signed check-in |
| Attendance | `batchConfirmAttendance()` | Batch version for multiple attendees |
| Badges | `claimBadge()` | Mints 1x soulbound ERC-1155 POAP (+25 VRYF) |
| Milestones | `milestoneReward()` | Mints soulbound NFT per unlocked tier |
| Certificates | `issueCertificate()` | Stores Certificate struct on-chain |
| Certificates | `revokeCertificate()` | Sets `isValid = false` |
| Certificates | `verifyCertificate()` | Public view: event, attendee, timestamp, validity |

#### 8.2 VRYFToken (ERC-20)

A standard ERC-20 token with a hard cap of 1,000,000 VRYF. Only the `VryfdAttendance` contract can mint new tokens, ensuring supply is exclusively driven by genuine platform engagement. On Sepolia, VRYF has no monetary value and serves as a participation score.

---

### 9. Backend Layer

The backend is an Express.js server functioning as a **trusted relayer**. It holds on-chain roles (`ORGANIZER_ROLE` + `RELAYER_ROLE`) and pays gas on behalf of users, enabling a gasless experience for attendees. There is no traditional database; server-side state is persisted in JSON files.

**Key Services**

- `relayerService.js` — Wallet initialization, RPC setup with fallback, join code validation, EIP-712 signature verification, attendee confirmation, and bulk certificate issuance.
- `certificateService.js` — Generates 1200×800 PNG certificates with QR codes, uploads images and ERC-1155 metadata JSON to IPFS via Pinata.
- `ipfsService.js` — Pinata API wrappers for pinning JSON and files; builds badge, milestone, and certificate metadata.

**API Routes**

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/relay/createEvent` | Create event on-chain (relayer pays gas) |
| POST | `/api/relay/joinCheckin` | Validate join code + signature; add to pending |
| POST | `/api/relay/confirmAttendee` | Confirm single attendee on-chain |
| POST | `/api/relay/confirmAllAttendees` | Batch confirm all pending attendees |
| POST | `/api/relay/issueCertificatesBulk` | Issue certs to all confirmed attendees |
| GET | `/api/certificates/mine/:address` | Fetch on-chain certificates for a wallet |
| POST | `/api/certificates/generate` | Generate PNG + QR + upload to IPFS |
| GET | `/api/verify/:certId` | Public certificate verification endpoint |
| GET | `/api/health` | Server health check |

---

### 10. Frontend Layer

The frontend is a Next.js 13+ application using TypeScript with the App Router. Wallet connectivity is handled by wagmi and RainbowKit, providing a polished connect modal supporting MetaMask, WalletConnect, and other popular wallets.

**Pages & Components**

| Page | Description |
| --- | --- |
| Dashboard | Hero section + 5 stat cards (Active Events, Check-ins, Badges, Tier, VRYF Balance) + events grid |
| Events | Main check-in interface: event list (left) + 3-part check-in flow (right) with join code and confirmation status |
| Badges | POAP badge grid (soulbound ERC-1155) + milestone section with 3-tier progress bars and claim buttons |
| Certificates | On-chain certificate list with per-cert actions: verify, download QR, share on LinkedIn |
| Organizer | 5-tab organizer dashboard: Create, Deploy, Manage, Attendance, Certificates |
| Leaderboard | Ranked by attendance count; shows ENS, event count, tier, and VRYF balance |

---

### 11. Token Economy — $VRYF

VRYFD includes a utility token ($VRYF) that serves as a participation score and engagement metric. It is earned automatically through platform activity with no purchases or staking.

| Action | VRYF Reward | NFT Minted |
| --- | --- | --- |
| Event check-in confirmed | +10 VRYF | — |
| POAP badge claimed | +25 VRYF | Soulbound ERC-1155 |
| Bronze milestone (5 events) | +100 VRYF | Soulbound NFT |
| Silver milestone (10 events) | +250 VRYF | Soulbound NFT |
| Gold milestone (20 events) | +500 VRYF | Soulbound NFT |

**Token Properties:** ERC-20 · Max Supply: 1,000,000 VRYF · Network: Sepolia Testnet · Monetary Value: None (testnet) · Minting: Only by `VryfdAttendance` contract

---

### 12. Data Architecture

VRYFD uses a three-tier data model where on-chain state is the source of truth, the backend maintains operational caches, and the frontend provides per-wallet local caching:

| Layer | Storage | Data |
| --- | --- | --- |
| On-Chain (Source of Truth) | Sepolia blockchain | `AttendanceRecord` per (eventId, attendee), Certificate structs, ERC-1155 balances, VRYF ERC-20 balances |
| Backend Cache | JSON files (`backend/data/`) | `deployedEvents.json` (tx hashes, join codes, confirmed counts), `events.json`, `pending.json` |
| Frontend Cache | localStorage | Per-wallet: check-ins, badges, VRYF balance, claimed milestones, badge mint times |

---

### 13. Key Design Patterns

**Gas Efficiency**
- **Relayer pattern** — Backend wallet pays all infrastructure gas costs, removing cost barriers for attendees
- **Gasless check-in** — Users sign EIP-712 typed data (free); the relayer submits the on-chain transaction
- **Batch operations** — `confirmAllAttendees()` and `issueCertificatesBulk()` reduce transaction count

**Scalability**
- **Paginated log queries** — Breaks blockchain event scans into 500-block chunks for RPC compatibility
- **In-memory caching** — Confirmed attendees cached server-side to minimize repeated chain reads
- **RPC failover** — Automatic switching between Alchemy and public endpoints on 429 rate limits

**Data Integrity**
- **Soulbound enforcement** — `_update()` override blocks all token transfers (mint/burn only)
- **Replay-proof signatures** — EIP-712 with per-wallet nonces stored on-chain
- **Duplicate prevention** — `issueCertificatesBulk()` reads existing certs before issuing new ones
- **Public verification** — `/api/verify/:certId` is read-only with no authentication required

---

### 14. Security Model

VRYFD employs multiple security layers to prevent attendance fraud and credential forgery:

- **Two-party check-in** — Attendees submit a venue-specific join code, then the organizer confirms physical presence. Both steps are required, making remote fraud nearly impossible.
- **Soulbound tokens** — POAP badges and milestone NFTs are non-transferable at the smart contract level, preventing credential trading or delegation.
- **EIP-712 typed signatures** — Check-in messages are signed with domain-specific typing and per-wallet nonces, preventing replay attacks and cross-contract exploitation.
- **Role-based access control** — Only wallets with `ORGANIZER_ROLE` can create events, confirm attendance, and issue or revoke certificates.
- **On-chain immutability** — All records are permanently stored on the blockchain. Certificates can be revoked (marked invalid) but never deleted from history.
- **IPFS-pinned metadata** — Badge and certificate metadata is stored on IPFS, ensuring it survives even if the VRYFD frontend or backend goes offline.
- **Public verification** — Anyone can verify credentials without an account by scanning a QR code or querying the smart contract directly via Etherscan.

---

### 15. Benefits & Use Cases

**For Attendees & Students**
- Build a verifiable, portable credential portfolio linked to your blockchain identity
- Showcase genuine achievements on LinkedIn with QR-verifiable certificates
- Earn progression rewards (milestone NFTs and VRYF tokens) for consistent engagement

**For Event Organizers**
- Eliminate fake attendance and automate the certification process
- Batch-confirm attendees and bulk-issue certificates with minimal effort
- Track real-time attendance with on-chain data integrity

**For Employers & Institutions**
- Instantly verify candidate claims by scanning a QR code or querying Etherscan
- Eliminate manual verification workflows with cryptographically anchored proof
- Cross-reference attendance history across multiple events and organizers

---

### 16. Future Scope

- **Job platform integration** — Direct credential sharing with hiring platforms for streamlined background verification
- **Advanced analytics dashboard** — Detailed engagement metrics, attendance trends, and organizer insights
- **DAO-based event governance** — Community-driven event curation and quality control via decentralized governance
- **Cross-chain compatibility** — Expand beyond Ethereum to support Polygon, Arbitrum, Base, and other L2 networks
- **Mainnet deployment** — Transition from Sepolia testnet to Ethereum mainnet for production use
- **Mobile native app** — Dedicated iOS and Android applications with push notifications and offline capabilities
- **CSV/API export** — Built-in attendee list export for organizers without requiring direct contract queries

---

### Setup & Run Guide

#### Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 18+ | Run `node --version` to verify |
| MetaMask | Create a separate **VRYFD Dev** account — never use a real wallet |
| Sepolia ETH | [sepoliafaucet.com](https://sepoliafaucet.com) — deploy needs ~0.01 Sepolia ETH |
| Pinata Account | [pinata.cloud](https://pinata.cloud) — free tier works |
| WalletConnect ID | [cloud.walletconnect.com](https://cloud.walletconnect.com) — free project |
| Etherscan API Key | etherscan.io → API Keys → Create |

#### Environment Variables

| Variable | Where to Get It |
| --- | --- |
| `PRIVATE_KEY` | MetaMask → VRYFD Dev → Account Details → Show Private Key |
| `SEPOLIA_RPC` | `https://rpc.sepolia.org` (default, works out of the box) |
| `ETHERSCAN_API_KEY` | etherscan.io → Sign Up → API Keys → Create |
| `PINATA_JWT` | Pinata Dashboard → API Keys → New Key → copy JWT |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | cloud.walletconnect.com → New Project → copy ID |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Set after deployment |
| `NEXT_PUBLIC_VRYF_TOKEN_ADDRESS` | Set after deployment |

> **WARNING:** Never commit `.env` to Git. Use a dedicated VRYFD Dev MetaMask account, never your real wallet.

#### Compile & Test Smart Contracts

```bash
# Compile
npx hardhat compile

# Run 18 tests
npx hardhat test

# Copy ABIs to frontend & backend
cp artifacts/contracts/VryfdAttendance.sol/VryfdAttendance.json frontend/src/abis/
cp artifacts/contracts/VryfdAttendance.sol/VryfdAttendance.json backend/src/abis/
```

#### Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script automatically:
1. Deploys `VRYFToken` (ERC-20)
2. Deploys `VryfdAttendance` (linked to the token)
3. Grants `MINTER_ROLE` so attendance actions auto-mint $VRYF
4. Verifies both contracts on Etherscan

Copy the two printed addresses into `.env`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x_attendance_address_here
NEXT_PUBLIC_VRYF_TOKEN_ADDRESS=0x_vryf_token_address_here
```

#### Sepolia Network Settings

| Setting | Value |
| --- | --- |
| Network Name | Sepolia |
| Chain ID | 11155111 |
| RPC URL | https://rpc.sepolia.org |
| Currency Symbol | ETH |
| Block Explorer | https://sepolia.etherscan.io |

#### Troubleshooting

| Issue | Fix |
| --- | --- |
| `npx hardhat` not found | Run `npm install` in the project root first |
| Contract deployment fails | Check wallet has Sepolia ETH and `PRIVATE_KEY` is correct |
| Frontend can't connect to contract | Verify `NEXT_PUBLIC_CONTRACT_ADDRESS` matches deployed address; restart dev server |
| $VRYF balance not showing | Set `NEXT_PUBLIC_VRYF_TOKEN_ADDRESS` in `.env`; import token in MetaMask |
| IPFS upload fails | Check `PINATA_JWT` in `.env`; ensure API key has pinning permissions |
| ENS name not resolving | Set `NEXT_PUBLIC_ALCHEMY_API_KEY` — ENS resolves against Ethereum mainnet |
| Tests fail after contract changes | Run `npx hardhat clean` then `npx hardhat compile` |
| Deploy says insufficient funds | Get Sepolia ETH from [sepoliafaucet.com](https://sepoliafaucet.com) |

#### VS Code Shortcuts

| Shortcut | What It Does |
| --- | --- |
| `Ctrl+Shift+P` → "Run Task" | Shows all project tasks (compile, test, deploy, start servers) |
| `F5` | Launch debugger (pick Next.js, Backend, or Hardhat test config) |
| `Ctrl+Shift+B` | Run the default build task (compile contracts) |
| `Ctrl+`` ` | Toggle integrated terminal |
| `Ctrl+Shift+E` | Switch between workspace folders (Contracts / Frontend / Backend) |
