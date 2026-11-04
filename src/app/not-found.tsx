import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <div className="grain grid min-h-screen place-items-center px-4 text-center">
      <div>
        <Link href="/" aria-label="Dabba Bela home">
          <Logo className="justify-center" />
        </Link>
        <p className="mt-10 font-marker text-6xl text-sindoor [filter:url(#rough)]" aria-hidden>
          404
        </p>
        <h1 className="mt-2 text-3xl font-extrabold">This dabba went to the wrong address.</h1>
        <p className="mt-2 text-ink-soft">The page you're looking for doesn't exist, or it has moved.</p>
        <p className="lang-ne mt-1 text-sm text-ink-mute">तपाईंले खोज्नुभएको पृष्ठ भेटिएन।</p>
        <div className="mt-6 flex flex-wrap justify-center gap-4 font-bold">
          <Link href="/" className="text-sindoor underline underline-offset-4">Home</Link>
          <Link href="/menu" className="text-sindoor underline underline-offset-4">This week's menu</Link>
        </div>
      </div>
    </div>
  );
}
