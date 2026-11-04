import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { staffHome } from "@/lib/permissions";

export default async function Forbidden() {
  const user = await getCurrentUser();
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="font-marker text-3xl text-sindoor">Oops — staff only.</p>
      <p className="mt-3 text-ink-mute">Your role doesn&apos;t have access to that section. Ask the owner if you need it.</p>
      <Link href={user ? staffHome(user.role) : "/"} className="mt-6 inline-block font-semibold text-sindoor underline">
        Back to my dashboard
      </Link>
    </div>
  );
}
