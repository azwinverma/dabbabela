"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <p className="font-marker text-3xl text-sindoor" aria-hidden>
          ohho!
        </p>
        <h1 className="mt-2 text-2xl font-extrabold">Something went wrong on our side.</h1>
        <p className="mt-2 text-ink-soft">Please try again. If it keeps happening, contact us{error.digest ? ` and mention code ${error.digest}` : ""}.</p>
        <button onClick={reset} className="mt-6 rounded-xl border-2 border-ink bg-besar px-5 py-2 font-bold shadow-sticker-sm">
          Try again
        </button>
      </div>
    </div>
  );
}
