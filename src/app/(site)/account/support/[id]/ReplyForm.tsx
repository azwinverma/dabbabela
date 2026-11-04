"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Textarea } from "@/components/ui/Fields";
import { replyTicketAction } from "@/lib/actions/account";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={replyTicketAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea label="Reply" name="body" rows={3} required maxLength={4000} />
      <SubmitButton size="sm">Send</SubmitButton>
    </ActionForm>
  );
}
