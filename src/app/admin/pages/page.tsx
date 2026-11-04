import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export default async function PagesIndex() {
  await requirePermission("content.view");
  const pages = await db.page.findMany({ orderBy: { title: "asc" } });
  return (
    <>
      <PageHeader title="Pages" description="Standalone pages like terms, privacy and refunds. Published at /info/<slug>." actions={<Link href="/admin/pages/new" className={buttonClass("primary", "sm")}>New page</Link>} />
      <Table>
        <thead>
          <tr>
            <Th>Title</Th>
            <Th>URL</Th>
            <Th>Footer</Th>
            <Th>Status</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {pages.length === 0 && <EmptyRow colSpan={5} />}
          {pages.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link href={`/admin/pages/${p.id}`} className="font-semibold hover:text-sindoor">
                  {p.title}
                </Link>
              </Td>
              <Td>
                <Link href={`/info/${p.slug}`} target="_blank" className="font-mono text-xs text-akash hover:underline">
                  /info/{p.slug}
                </Link>
              </Td>
              <Td>{p.showInFooter ? "Yes" : "—"}</Td>
              <Td>
                {p.published ? <Badge tone="good">Published</Badge> : <Badge tone="warn">Hidden</Badge>}
                {p.needsLegalReview && <Badge tone="bad" className="ml-1.5">Needs legal review</Badge>}
              </Td>
              <Td className="text-xs text-ink-mute">{formatStamp(p.updatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
