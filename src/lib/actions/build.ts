"use server";

import { getCurrentUser } from "@/lib/auth";
import { CustomBoxError, quoteBuild, saveBuiltBox, type BuildQuote } from "@/server/custom-boxes";

export type { BuildQuote };

/** Live price for the builder. Always computed on the server from current dish data. */
export async function quoteBuildAction(picks: unknown, diet?: unknown): Promise<BuildQuote> {
  return quoteBuild(picks, diet);
}

/** Save a built dabba to the customer's account so it can be ordered (any service day) or used in plans. */
export async function saveBuildAction(input: { name: string; picks: unknown; diet?: unknown }): Promise<{ ok: true; id: string; price: number; name: string } | { ok: false; message: string; login?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to save your dabba", login: true };
  try {
    const box = await saveBuiltBox(user.id, { name: input?.name, picks: input?.picks, diet: input?.diet });
    return { ok: true, id: box.id, price: box.price, name: box.name };
  } catch (e) {
    if (e instanceof CustomBoxError) return { ok: false, message: e.message };
    throw e;
  }
}
