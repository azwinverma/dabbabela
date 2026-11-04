import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { storeUpload } from "@/lib/upload";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Staff media upload → Vercel Blob (dev: public/uploads). Records a MediaAsset row. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !(can(user.role, "media") || can(user.role, "menu") || can(user.role, "content") || can(user.role, "marketing")))
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const s = await getSettings();
  const twoFaExempt = process.env.DISABLE_STAFF_2FA === "true" && process.env.NODE_ENV !== "production";
  if (s.flags.staff2fa && !user.twoFactorEnabled && !twoFaExempt) return NextResponse.json({ error: "Turn on two-factor authentication first" }, { status: 403 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const alt = typeof form.get("alt") === "string" ? String(form.get("alt")).slice(0, 200) : null;
  const credit = typeof form.get("credit") === "string" ? String(form.get("credit")).slice(0, 200) : null;
  const isPlaceholder = form.get("placeholder") === "on" || form.get("placeholder") === "true";
  try {
    const stored = await storeUpload(file, { folder: "media" });
    const asset = await db.mediaAsset.create({
      data: { url: stored.url, name: stored.name, type: stored.type, size: stored.size, alt: alt || null, credit: credit || null, isPlaceholder, uploadedById: user.id },
    });
    await audit({ actorId: user.id, action: "media.upload", entity: "MediaAsset", entityId: asset.id, summary: stored.name });
    return NextResponse.json({ url: stored.url, id: asset.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
