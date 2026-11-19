import { SiteLoading } from "@/components/site/PageStates";

export default function Loading() {
  return (
    <section className="container py-10">
      <SiteLoading rows={4} />
    </section>
  );
}
