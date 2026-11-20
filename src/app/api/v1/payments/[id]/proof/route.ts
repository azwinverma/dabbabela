import { apiRoute } from "@/server/api/route";
import { ApiError, badRequest } from "@/server/api/http";
import { assertOwnPayment } from "@/server/api/customer-dto";
import { submitTransferProof } from "@/server/payments";
import { storeUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";

/**
 * Bank transfer proof (multipart/form-data): `proof` = screenshot or receipt (JPG/PNG/WEBP/AVIF/PDF, ≤ 5 MB),
 * `reference` = transaction reference from the bank app. Finance verifies it against the bank statement.
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "upload" }, async ({ req, user, params }) => {
  await assertOwnPayment(user.id, params.id);
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw badRequest("Send multipart/form-data with `proof` and `reference`");
  }
  const file = fd.get("proof");
  const reference = typeof fd.get("reference") === "string" ? String(fd.get("reference")).trim().slice(0, 100) : "";
  if (!(file instanceof File) || !file.size) throw new ApiError(422, "VALIDATION_FAILED", "Attach the screenshot or receipt", { proof: "Required" });
  if (reference.length < 3) throw new ApiError(422, "VALIDATION_FAILED", "Enter the transaction reference from your bank app", { reference: "Required" });
  let url: string;
  try {
    url = (await storeUpload(file, { allowPdf: true, folder: "payment-proofs" })).url;
  } catch (e) {
    throw new ApiError(422, "UPLOAD_REJECTED", e instanceof Error ? e.message : "Upload failed — try again");
  }
  await submitTransferProof(params.id, user.id, url, reference);
  return { proofSubmitted: true, message: "Thanks — we'll confirm your payment shortly. Your order is saved." };
});
