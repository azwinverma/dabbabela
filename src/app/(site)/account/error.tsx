"use client";

import { SiteError } from "@/components/site/SiteError";

export default function AccountError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SiteError error={error} reset={reset} />;
}
