import { apiRoute } from "@/server/api/route";
import { walletBalance } from "@/server/ledger";
import { topupEnabled, topupLimits, topupMethods } from "@/server/wallet-topup";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Wallet (Dabba Bela store credit): balance in paisa, and — when top-ups are on (`flags.walletTopup`) — the methods and
 * limits that apply to the caller right now (`maxNow` = largest top-up allowed at this moment, 0 = none).
 */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const settings = await getSettings();
  const enabled = topupEnabled(settings);
  const [balance, limits, methods] = await Promise.all([walletBalance(user.id), enabled ? topupLimits(user.id, settings) : null, enabled ? topupMethods(settings) : []]);
  return {
    balance,
    walletEnabled: settings.flags.wallet,
    topup: enabled && limits
      ? { enabled: true, methods, min: limits.min, max: limits.max, daily: limits.daily, cap: limits.cap, usedToday: limits.usedToday, pendingToday: limits.pendingToday, maxNow: limits.maxNow, note: "Closed-loop store credit: spendable only on Dabba Bela meals; not cash, not transferable." }
      : { enabled: false, methods: [], min: null, max: null, daily: null, cap: null, usedToday: null, pendingToday: null, maxNow: null, note: null },
  };
});
