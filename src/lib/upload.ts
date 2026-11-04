import "server-only";
import { put } from "@vercel/blob";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomCode, slugify } from "./utils";

const IMAGE = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const DOCS = ["application/pdf"];
export const MAX_UPLOAD = 5 * 1024 * 1024;

/** Sniff the first bytes so a renamed file can't pass as an image (SVG is not accepted: it can carry script). */
function sniff(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString().includes("ftypavif")) return "image/avif";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

/**
 * Store an upload in Vercel Blob. Local disk is allowed only in development —
 * serverless filesystems are ephemeral, so production refuses without a Blob token.
 */
export async function storeUpload(file: File, opts: { allowPdf?: boolean; folder?: string } = {}) {
  const allowed = opts.allowPdf ? [...IMAGE, ...DOCS] : IMAGE;
  if (file.size > MAX_UPLOAD) throw new Error("Files must be under 5 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type || !allowed.includes(type)) throw new Error(opts.allowPdf ? "Upload a JPG, PNG, WEBP, AVIF or PDF" : "Upload a JPG, PNG, WEBP or AVIF image");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "application/pdf": "pdf" }[type]!;
  const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
  const name = `${base}-${randomCode(8).toLowerCase()}.${ext}`;
  const folder = (opts.folder ?? "media").replace(/[^a-z0-9-]/g, "");

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`dabbabela/${folder}/${name}`, buf, { access: "public", contentType: type, addRandomSuffix: false });
    return { url: blob.url, name, type, size: file.size };
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("Uploads need a Vercel Blob store (BLOB_READ_WRITE_TOKEN)");
  const dir = path.join(process.cwd(), "public", "uploads", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buf);
  return { url: `/uploads/${folder}/${name}`, name, type, size: file.size };
}
