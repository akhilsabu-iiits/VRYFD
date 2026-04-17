/**
 * Shared test configuration & test data.
 * All values can be overridden via environment variables.
 */
export const CONFIG = {
  BACKEND_URL: process.env.TEST_BACKEND_URL || "http://localhost:3001",
  FRONTEND_URL: process.env.TEST_FRONTEND_URL || "http://localhost:3000",
  RPC_URL:
    process.env.TEST_RPC_URL ||
    "https://eth-sepolia.g.alchemy.com/v2/k-PnI9nPzDBISj_ARJ7WP",
  CONTRACT_ADDRESS:
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    "0x48d889851394A378d2F42bC3b423315e547C02f4",
  TOKEN_ADDRESS:
    process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS ||
    "0x9E27880D8DbC7746fB3638F75a5FB743d1a85393",
  RELAYER_PRIVATE_KEY:
    process.env.TEST_RELAYER_PK ||
    "0x4ff7b0a95bba366526220ff97cb86e48478573f91b15afd0b2ee4c1bbe015975",
  RELAYER_ADDRESS: "0xF9dd7D371aEfd9BF7923c576B7FFE1F863EcB6C3",
  ADMIN: {
    email: "admin@vryfd.com",
    password: "admin123",
  },
  TEST_ATTENDEE: {
    email: `attendee-${Date.now()}@vryfd.test`,
    password: "Attendee123!",
    name: "Test Attendee",
  },
  TEST_ORGANIZER: {
    email: `organizer-${Date.now()}@vryfd.test`,
    password: "Organizer123!",
    name: "Test Organizer",
  },
};
