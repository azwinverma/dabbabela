import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { findInvite, acceptInvite } from "@/server/team";
import { LinkButton } from "@/components/ui/Button";
import { Logo } from "@/components/brand/Logo";

export const metadata = { title: "Join your team", robots: { index: false } };

export default async function AcceptInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/team/invite/${token}`)}`);
  const invite = await findInvite(token);

  async function accept() {
    "use server";
    const u = await getCurrentUser();
    if (!u) redirect(`/login?next=/team/invite/${token}`);
    await acceptInvite(token, { id: u.id, email: u.email });
    redirect("/account?team=joined");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-line bg-white p-8 shadow-card">
        <Logo className="mb-6" />
        {!invite ? (
          <>
            <h1 className="font-display text-xl font-bold">This invite has expired</h1>
            <p className="mt-2 text-sm text-ink-soft">Invites last 14 days and work once. Ask your office admin to send a new one, or use your company&apos;s join code in your profile.</p>
            <LinkButton href="/account" variant="dark" size="sm" className="mt-5">
              Go to my account
            </LinkButton>
          </>
        ) : invite.email !== user.email.toLowerCase() ? (
          <>
            <h1 className="font-display text-xl font-bold">Wrong account</h1>
            <p className="mt-2 text-sm text-ink-soft">
              This invite to <b>{invite.company.name}</b> was sent to <b>{invite.email}</b>, but you&apos;re signed in as {user.email}. Log out and sign in (or sign up) with the invited email.
            </p>
            <Link href="/account" className="mt-5 inline-block text-sm font-semibold text-sindoor underline">
              My account
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">Join {invite.company.name}&apos;s team lunches</h1>
            <p className="mt-2 text-sm text-ink-soft">Your company&apos;s discount and lunch allowance apply automatically once you join. You can leave any time from your profile.</p>
            <form action={accept} className="mt-6">
              <button className="h-11 w-full rounded-xl border-2 border-ink bg-sindoor font-semibold text-paper-card shadow-sticker">Join the team</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
