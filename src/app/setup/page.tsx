import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/brand/Logo";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Set up Dabba Bela", robots: { index: false } };

export default async function SetupPage() {
  let done = false;
  let dbError = "";
  try {
    done = (await db.user.count({ where: { role: "SUPER_ADMIN" } })) > 0;
  } catch (e) {
    dbError = e instanceof Error ? e.message.split("\n")[0] : "Database unreachable";
  }
  return (
    <div className="grain min-h-screen py-16">
      <div className="container max-w-lg">
        <Logo />
        <div className="card mt-8 p-7 shadow-sticker-lg">
          <h1 className="text-3xl font-extrabold">First-time setup</h1>
          {dbError ? (
            <p className="mt-3 text-sindoor">Can&apos;t reach the database: {dbError}. Check DATABASE_URL and that migrations ran.</p>
          ) : done ? (
            <p className="mt-3 text-ink-soft">
              Setup is complete. <Link href="/login" className="font-semibold text-sindoor underline">Log in to the control room</Link>.
            </p>
          ) : !process.env.SETUP_KEY ? (
            <p className="mt-3 text-ink-soft">
              Add a <code className="rounded bg-paper-deep px-1">SETUP_KEY</code> environment variable (any long random string), redeploy, then come back here.
            </p>
          ) : (
            <>
              <p className="mt-2 text-ink-soft">This creates the owner (super admin) account and loads the starter menu, recipes, delivery zones, plans and policy drafts. It only works once. You'll be asked to turn on two-factor authentication before entering the control room.</p>
              <div className="mt-6">
                <SetupForm allowDemo={process.env.NODE_ENV !== "production"} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
