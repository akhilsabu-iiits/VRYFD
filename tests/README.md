# VRYFD End-to-End Test Suite

Comprehensive Playwright test suite covering API and UI flows for the VRYFD on-chain attendance platform.

## Prerequisites

Before running tests, **start both servers** in separate terminals:

```powershell
# Terminal 1 — backend (Sepolia)
cd backend && npm start

# Terminal 2 — frontend
cd frontend && npm run dev
```

Wait for `🚀 VRYFD Backend running on http://localhost:3001` and `Ready in …` from the frontend.

## Running tests

From the `tests/` folder:

```powershell
# Run everything (API + UI, headless)
npm test

# Run only API tests (fast, no browser)
npm run test:api

# Run only UI tests in a visible browser (so you can watch)
npm run test:headed

# Interactive UI mode (great for debugging individual tests)
npm run test:watch

# Open HTML report after a run
npm run report
```

## Test layout

```
tests/
├── api/                      # Backend contract tests (no browser)
│   ├── 01-health.spec.ts            # Server reachability + CORS
│   ├── 02-auth.spec.ts              # Login, invite, signup, role checks
│   ├── 03-events.spec.ts            # On-chain event creation
│   └── 04-tokens-verify.spec.ts     # VRYF token reads, certificate verify, attendance
├── ui/                       # Browser-based flows (Playwright Chromium)
│   ├── 01-public-pages.spec.ts      # Login, redirects, public access
│   ├── 02-admin-flow.spec.ts        # Admin login + sidebar navigation
│   ├── 03-role-access.spec.ts       # Role-based access (admin/organizer/attendee)
│   ├── 04-marketplace-events.spec.ts # Marketplace, dashboard, profile, claim
│   └── 05-no-console-errors.spec.ts # Catches uncaught client-side errors
├── fixtures/
│   ├── config.ts             # Endpoints, addresses, credentials
│   └── helpers.ts            # Login, auth, event helpers
└── playwright.config.ts
```

## Test data used

| Item | Value |
|---|---|
| Admin email | `admin@vryfd.com` |
| Admin password | `admin123` |
| Sepolia contract | `0x48d889851394A378d2F42bC3b423315e547C02f4` |
| VRYF token | `0x9E27880D8DbC7746fB3638F75a5FB743d1a85393` |
| Relayer wallet | `0xF9dd7D371aEfd9BF7923c576B7FFE1F863EcB6C3` |

Fresh organizer/attendee accounts are created on the fly via the invite flow inside `03-role-access.spec.ts` so tests are repeatable.

## Override via environment variables

```powershell
$env:TEST_BACKEND_URL  = "http://localhost:3001"
$env:TEST_FRONTEND_URL = "http://localhost:3000"
$env:TEST_RELAYER_PK   = "0x..."  # if you want to use a different signer
npm test
```

## What gets tested

### API
- ✅ Server health & CORS
- ✅ Authentication (login, invite, signup, role enforcement)
- ✅ Event creation on Sepolia (real on-chain transaction)
- ✅ VRYF token balance & history (read from contract)
- ✅ Certificate verify (rejects invalid IDs, returns 404 for missing)
- ✅ Wallet-required policy on issueCertificate (PRD §11)
- ✅ Attendance check-in/checkout/active count
- ✅ QR code generation for in-person events

### UI
- ✅ Public routing (login, redirects from legacy paths)
- ✅ Admin login + sidebar shows all 7 links
- ✅ Sidebar shows correct items per role (admin / organizer / attendee)
- ✅ Each role can navigate to authorized pages without errors
- ✅ Attendees redirected from `/organizer` and `/admin`
- ✅ Verify page auto-loads from `?id=` query param
- ✅ All authenticated pages load without console errors

## Known limitations

Wallet-signature flows (claiming a certificate, signing meta-transactions) require either MetaMask or a programmatic signer wired into `window.ethereum`. The current suite covers these at the **API level** (using the relayer's private key with `ethers`); **UI wallet flows are best verified manually** with the headed browser open.
