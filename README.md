# VRYFD — Blockchain Attendance Verification

> Gasless attendance check-in with soulbound POAP badges, milestone NFT rewards, VRYF token earnings, and blockchain-verified certificates on **Sepolia testnet**.

---

## What is VRYFD?

VRYFD lets event organizers deploy on-chain events and attendees check in gaslessly using EIP-712 signatures. The relayer wallet pays all gas. Attendees earn:

- **POAP Badges** — Soulbound ERC-1155 NFTs for each event attended
- **VRYF Tokens** — ERC-20 rewards for check-ins, badges, and milestones
- **Milestone NFTs** — Bronze (5 events), Silver (10), Gold (20)
- **Certificates** — On-chain verifiable attendance certificates with QR codes

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity, Hardhat, OpenZeppelin ERC-1155 |
| Frontend | Next.js 14, wagmi v2, RainbowKit, TypeScript |
| Backend | Node.js, Express, ethers.js v6 |
| Network | Ethereum Sepolia Testnet |
| Wallet | MetaMask, WalletConnect |
| Storage | IPFS via Pinata |

---

## Project Structure

```
VRYFD/
├── contracts/
│   └── VryfdAttendance.sol     # ERC-1155 + ERC-20 + certificates
├── scripts/
│   └── deploy.js               # Hardhat deploy script
├── frontend/                   # Next.js app
│   └── src/
│       ├── app/
│       │   ├── page.tsx        # Main app + all state
│       │   └── globals.css     # All styles (responsive)
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── EventsPage.tsx  # Check-in flow
│       │   ├── BadgesPage.tsx  # POAP + milestone NFTs
│       │   ├── VRYFPage.tsx    # Token balance + history
│       │   ├── LeaderboardPage.tsx
│       │   ├── CertificatePage.tsx
│       │   └── OrganizerPage.tsx
│       ├── lib/
│       │   ├── vryfd.ts        # Types + constants
│       │   └── ensOverrides.ts # ENS address overrides
│       ├── abis/               # Contract ABIs
│       └── utils/
│           └── wagmiConfig.ts  # Chain + connector config
└── backend/                    # Express API server
    ├── data/
    │   ├── deployedEvents.json # Persisted event + attendee state
    │   └── pending.json        # Pending check-in queue
    └── src/
        ├── index.js            # Server entry point
        ├── middleware/
        │   └── adminAuth.js    # x-admin-secret header guard
        ├── routes/
        │   ├── relayer.js      # Check-in, badge, milestone, ENS routes
        │   ├── certificates.js # Certificate issue + fetch
        │   ├── metadata.js     # On-chain NFT metadata (SVG)
        │   ├── ipfs.js         # Pinata IPFS upload
        │   └── verify.js       # Public certificate verification
        └── services/
            ├── relayerService.js     # Core chain logic + in-memory stores
            ├── certificateService.js # Certificate generation
            ├── ipfsService.js        # Pinata integration
            └── ensOverrides.js       # ENS address mappings
```

---

## Local Development

### Prerequisites
- Node.js 18+
- MetaMask browser extension
- Sepolia testnet ETH — [sepoliafaucet.com](https://sepoliafaucet.com)

### 1. Clone & Install
```bash
git clone https://github.com/akhilsabu-iiits/VRYFD.git
cd VRYFD
npm install                  # root (hardhat)
cd frontend && npm install
cd ../backend && npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Fill in your values (see Environment Variables section below)
```

### 3. Compile Contracts
```bash
npx hardhat compile
```

### 4. Deploy to Sepolia
```bash
npx hardhat run scripts/deploy.js --network sepolia
# Copy the printed contract address into .env → NEXT_PUBLIC_CONTRACT_ADDRESS
```

### 5. Start Dev Servers
```bash
# Terminal 1 — Backend (port 3001)
cd backend && npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Blockchain
PRIVATE_KEY=                          # Relayer wallet private key (pays gas)
NEXT_PUBLIC_CONTRACT_ADDRESS=         # Deployed VryfdAttendance contract
NEXT_PUBLIC_VRYF_TOKEN_ADDRESS=       # Deployed VRYFToken contract
NEXT_PUBLIC_CHAIN_ID=11155111         # Sepolia

# Alchemy
ALCHEMY_API_KEY=                      # For RPC + ENS lookups

# Backend
PORT=3001
ADMIN_SECRET=                         # Protects organizer API routes
FRONTEND_ORIGIN=http://localhost:3000 # CORS origin
BACKEND_URL=http://localhost:3001     # Used in certificate QR codes

# Frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID= # From cloud.walletconnect.com

# IPFS (optional)
PINATA_JWT=                           # For IPFS metadata pinning
```

---

## Check-in Flow

```
Attendee connects wallet
        ↓
Enters 6-digit join code (provided by organizer)
        ↓
Signs EIP-712 message (no gas required)
        ↓
Backend verifies signature → relayer submits tx → confirmed on-chain
        ↓
Organizer confirms attendance in Organizer dashboard
        ↓
Attendee claims POAP Badge (gasless) → earns +25 VRYF
        ↓
Milestone thresholds unlock NFT rewards (+100/250/500 VRYF)
        ↓
Organizer issues certificate → attendee gets QR-verified certificate
```

---

## API Endpoints

### Relay — `/api/relay`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/deployedEvents` | All deployed events with attendee data |
| GET | `/join-code/:eventId` | Get 6-digit join code for event |
| POST | `/joinCheckin` | Gasless check-in via join code |
| GET | `/checkin-status/:eventId/:address` | Check if wallet is confirmed |
| GET | `/checkin-nonce/:address` | EIP-712 nonce for signing |
| POST | `/gaslessClaimBadge` | Claim POAP badge (relayer pays gas) |
| POST | `/gaslessMilestoneReward` | Claim milestone NFT (relayer pays gas) |
| GET | `/attendees/:eventId` | All confirmed attendees + txHashes |
| GET | `/attendee-count/:eventId` | Confirmed attendee count |
| POST | `/confirmAttendee` | Organizer: confirm one attendee |
| POST | `/confirmAllAttendees` | Organizer: confirm all pending |
| POST | `/createEvent` | Organizer: deploy new event on-chain |
| POST | `/issueCertificatesBulk` | Organizer: bulk issue certificates |
| GET | `/ens/:address` | Reverse ENS lookup |
| POST | `/reset` | Reset all state (dev only) |

### Certificates — `/api/certificates`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/mine/:address` | All certificates for a wallet |
| POST | `/generate` | Generate certificate + pin to IPFS |

### Metadata — `/api/metadata`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/badge/:eventId` | ERC-1155 badge metadata JSON |
| GET | `/badge/:eventId/pin` | Pin badge metadata to IPFS |
| GET | `/milestone/:threshold` | Milestone NFT metadata JSON |

### Verify — `/api/verify`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:certificateId` | Public certificate verification |

---

## Deployment (Vercel + Railway)

### Backend → Railway
1. New Project → Deploy from GitHub → select **VRYFD**
2. Set Root Directory = `backend`
3. Add all environment variables in the Railway dashboard
4. Railway auto-deploys on every `git push`

### Frontend → Vercel
1. New Project → Import from GitHub → select **VRYFD**
2. Set Root Directory = `frontend`
3. Add environment variables:
   - `NEXT_PUBLIC_BACKEND_URL` = your Railway URL
   - `NEXT_PUBLIC_CONTRACT_ADDRESS` = your contract address
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` = your WalletConnect ID
4. Vercel auto-deploys on every `git push`

---

## Contract: VryfdAttendance

| Function | Description |
|----------|-------------|
| `createEvent()` | Deploy new event (organizer only) |
| `checkInFor()` | Relayer submits confirmed check-in |
| `claimBadge()` | Mint soulbound POAP ERC-1155 NFT |
| `claimMilestoneReward()` | Mint milestone NFT + earn VRYF |
| `issueCertificate()` | Issue on-chain attendance certificate |
| `revokeCertificate()` | Organizer revoke certificate |
| `getAttendanceRecord()` | Check wallet attendance + badge status |

**Token ID ranges:**
- Badge NFTs: start at `1000`
- Milestone NFTs: start at `500000`

---

## VRYF Token Rewards

| Action | Reward |
|--------|--------|
| Check-in confirmed | +10 VRYF |
| POAP Badge claimed | +25 VRYF |
| Bronze milestone (5 events) | +100 VRYF |
| Silver milestone (10 events) | +250 VRYF |
| Gold milestone (20 events) | +500 VRYF |

---

## License

MIT
