import { requireCompanyAdmin } from "@/lib/auth";
import { formatDay } from "@/lib/dates";
import { Table, Th, Td, EmptyRow, Panel } from "@/components/admin/ui";
import { teamDeliveries, officeLocations } from "@/server/team";
import { TeamDeliveryForm } from "../TeamForms";

export const metadata = { title: "Deliveries" };

export default async function TeamDeliveries() {
  const { company } = await requireCompanyAdmin();
  const [{ groups, instructions }, offices] = await Promise.all([teamDeliveries(company.id, 14), officeLocations(company.id)]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Upcoming deliveries</h1>
        <p className="text-sm text-ink-mute">Next two weeks, grouped by office and delivery window — what arrives where.</p>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Day</Th>
            <Th>Office</Th>
            <Th>Window</Th>
            <Th className="text-right">Dabbas</Th>
            <Th>For</Th>
          </tr>
        </thead>
        <tbody>
          {groups.length ? (
            groups.map((g, i) => (
              <tr key={i} className="align-top">
                <Td className="whitespace-nowrap text-xs">{formatDay(g.date)}</Td>
                <Td>
                  <span className="font-semibold">{g.office}</span>
                  <span className="block text-xs text-ink-mute">
                    {g.address}
                    {g.receiver ? ` · receiver ${g.receiver}` : ""}
                  </span>
                </Td>
                <Td className="text-xs">{g.slot ?? "—"}</Td>
                <Td className="text-right tabular-nums">{g.meals}</Td>
                <Td className="text-xs">
                  {g.people.slice(0, 8).join(", ")}
                  {g.people.length > 8 ? ` +${g.people.length - 8}` : ""}
                </Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={5}>Nothing booked for the next two weeks.</EmptyRow>
          )}
        </tbody>
      </Table>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Delivery instructions">
          <TeamDeliveryForm value={instructions} />
        </Panel>
        <Panel title="Your offices">
          {offices.length ? (
            <ul className="space-y-1 text-sm">
              {offices.map((o) => (
                <li key={o.id}>
                  <span className="font-semibold">{o.name}</span>{" "}
                  <span className="text-xs text-ink-mute">
                    {[o.line1, o.area].join(", ")}
                    {o.receiverName ? ` · ${o.receiverName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">No offices yet — ask Dabba Bela to add your office addresses.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
