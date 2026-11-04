import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export default async function BlogIndex() {
  await requirePermission("content");
  const posts = await db.post.findMany({ orderBy: [{ published: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }] });
  return (
    <>
      <PageHeader title="Journal" description="Stories from the kitchen — good for SEO and for giving people a reason to trust the food. Live at /journal." actions={<Link href="/admin/blog/new" className={buttonClass("primary", "sm")}>New post</Link>} />
      <Table>
        <thead>
          <tr>
            <Th>Post</Th>
            <Th>Tags</Th>
            <Th>Status</Th>
            <Th>Published</Th>
          </tr>
        </thead>
        <tbody>
          {posts.length === 0 && <EmptyRow colSpan={4}>No posts yet.</EmptyRow>}
          {posts.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link href={`/admin/blog/${p.id}`} className="font-semibold hover:text-sindoor">
                  {p.title}
                </Link>
                <div className="line-clamp-1 text-xs text-ink-mute">{p.excerpt}</div>
              </Td>
              <Td className="text-xs text-ink-mute">{p.tags.join(", ") || "—"}</Td>
              <Td>{p.published ? <Badge tone="good">Live</Badge> : <Badge tone="warn">Draft</Badge>}</Td>
              <Td className="text-xs text-ink-mute">{p.publishedAt ? formatStamp(p.publishedAt) : "—"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
