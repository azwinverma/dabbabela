"use client";

import { ErrorState } from "@/components/admin/States";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState retry={reset}>
      This page couldn&apos;t load. Try again; if it keeps failing, share this code with the tech team{error.digest ? `: ${error.digest}` : ""}.
    </ErrorState>
  );
}
