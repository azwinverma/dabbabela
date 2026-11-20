import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, CmsError, revalidateCms, type CmsActor } from "./access";
import { RESERVED_SLUGS } from "./pages";
import { isSafeHref, isSitePath, normalisePath } from "./urls";

/**
 * Redirects (`Redirect` model), resolved by the catch-all route `src/app/(site)/[...slug]` after published CMS pages,
 * so they apply to any path that no fixed route or CMS page answers. No middleware involved.
 * `from` is stored normalised (lower-case, no trailing slash, no query). Loops and chains are refused on save.
 */

export async function resolveRedirect(path: string, opts: { countHit?: boolean } = {}) {
  const from = normalisePath(path);
  const r = await db.redirect.findUnique({ where: { from } }).catch(() => null);
  if (!r || !isSafeHref(r.to)) return null;
  if (opts.countHit !== false) await db.redirect.update({ where: { id: r.id }, data: { hits: { increment: 1 } } }).catch(() => null);
  return { to: r.to, permanent: r.permanent };
}

export type RedirectInput = { from: string; to: string; permanent?: boolean };

export async function saveRedirect(actor: CmsActor, id: string | null, input: RedirectInput) {
  assertCan(actor, "seo.edit");
  const from = normalisePath(input.from);
  if (!isSitePath(from) || from === "/") throw new CmsError("'From' must be a site path like /old-page");
  const first = from.split("/")[1] ?? "";
  if (RESERVED_SLUGS.has(first)) throw new CmsError(`/${first} is a built-in page — a redirect there would never run`);
  const to = input.to.trim();
  if (!isSafeHref(to) || to.startsWith("mailto:") || to.startsWith("tel:") || to.startsWith("#")) throw new CmsError("'To' must be a site path or an https:// URL");
  if (to.startsWith("/") && normalisePath(to) === from) throw new CmsError("A redirect can't point to itself");
  if (to.startsWith("/")) {
    const next = await db.redirect.findUnique({ where: { from: normalisePath(to) } });
    if (next && next.id !== id) throw new CmsError(`${to} already redirects to ${next.to} — point straight there instead`);
  }
  const into = await db.redirect.findFirst({ where: { to: { in: [from, `${from}/`] }, NOT: id ? { id } : undefined } });
  if (into) throw new CmsError(`${into.from} redirects here — update it to point to ${to} instead of chaining`);
  const clash = await db.redirect.findFirst({ where: { from, NOT: id ? { id } : undefined } });
  if (clash) throw new CmsError("There's already a redirect from that path");
  const before = id ? await db.redirect.findUnique({ where: { id } }) : null;
  const data = { from, to, permanent: input.permanent ?? true };
  const r = id ? await db.redirect.update({ where: { id }, data }) : await db.redirect.create({ data });
  await audit({ actorId: actor.id, action: id ? "redirect.update" : "redirect.create", entity: "Redirect", entityId: r.id, summary: `${from} → ${to}`, before, after: data });
  revalidateCms([from]);
  return r;
}

export async function deleteRedirect(actor: CmsActor, id: string) {
  assertCan(actor, "seo.edit");
  const r = await db.redirect.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "redirect.delete", entity: "Redirect", entityId: id, summary: `${r.from} → ${r.to}`, before: r });
  revalidateCms([r.from]);
}

export async function listRedirects() {
  return db.redirect.findMany({ orderBy: { from: "asc" } });
}
