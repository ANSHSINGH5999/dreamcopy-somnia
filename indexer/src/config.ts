import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEXER_ROOT = path.resolve(__dirname, "..");
const CONTRACTS_ENV_PATH = path.resolve(INDEXER_ROOT, "../contracts/.env");

loadDotenv({ path: path.resolve(INDEXER_ROOT, ".env") });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var ${name} — set it in dreamcopy/indexer/.env`);
  }
  return value;
}

/// The executor's signing key lives in dreamcopy/contracts/.env (PRIVATE_KEY)
/// — the same deployer key that deployed CopyVault, per the user's own
/// instruction — not duplicated into indexer/.env, so there's exactly one
/// place it can go stale or leak from.
function readDeployerPrivateKey(): string {
  if (!existsSync(CONTRACTS_ENV_PATH)) {
    throw new Error(
      `Deployer key not found: ${CONTRACTS_ENV_PATH} does not exist. Deploy the contracts first ` +
        `(see dreamcopy/contracts/README.md / docs/ARCHITECTURE.md).`,
    );
  }
  const parsed = parseDotenv(readFileSync(CONTRACTS_ENV_PATH, "utf8"));
  const key = parsed.PRIVATE_KEY;
  if (!key) {
    throw new Error(`PRIVATE_KEY not set in ${CONTRACTS_ENV_PATH}`);
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

export const config = {
  rpcUrl: process.env.RPC_URL ?? "https://dream-rpc.somnia.network",
  wsUrl: process.env.DREAMDEX_WS_URL ?? "wss://stg.api.dreamdex.io/v0/ws/public",
  restBase: process.env.DREAMDEX_REST_BASE ?? "https://stg.api.dreamdex.io/v0",

  traderRegistryAddress: requireEnv("TRADER_REGISTRY_ADDRESS", "0x0b9F64A7f6a4868d87588E8513c5b24d7482622F"),
  copyVaultAddress: requireEnv("COPY_VAULT_ADDRESS", "0x0dFBfcaAaDD3cCf7AB6Ff840ee1adb01b063CF22"),
  referralRegistryAddress: requireEnv("REFERRAL_REGISTRY_ADDRESS", "0x7E16a950FeE445aF67A720FbDA13b9d93372b035"),

  deployerPrivateKey: readDeployerPrivateKey(),

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",

  // Supabase — activity-log only (copy_trades). Optional: if unset, inserts
  // are skipped with a warning rather than crashing the indexer (same
  // "never let a side-effect take down the trade loop" rule as Telegram).
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? "",

  traderRefreshMs: Number(process.env.TRADER_REFRESH_MS ?? 30_000),
  logRawMessages: process.env.LOG_RAW_MESSAGES === "1",
  wsSubscribeMessage: process.env.WS_SUBSCRIBE_MESSAGE || null,

  /// Raw collateral-token units (not human-decimal — collateralToken's
  /// actual decimals vary; see DreamDEXMarket.quoteDecimals in
  /// web/src/lib/dreamdex.ts). Below this, a proportionally-scaled trade is
  /// skipped rather than sent as on-chain dust. Tune to your collateral
  /// token's decimals — the default here is deliberately conservative.
  dustThreshold: BigInt(process.env.DUST_THRESHOLD ?? "1000"),
};
