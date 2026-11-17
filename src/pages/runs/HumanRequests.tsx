// What the run is waiting on people for: approvals and replies.
import { useState } from "react";
import { Check, Send, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { HumanRequest } from "@/run/events";
import { Clamp } from "./Timeline";

function RequestCard({ r, nameOf, onAnswer }: { r: HumanRequest; nameOf: (id: string) => string; onAnswer: (a: { approved?: boolean; text?: string }) => void }) {
  const [text, setText] = useState("");
  return (
    <li className="space-y-2 rounded-lg bg-warning/10 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <UserCheck className="h-3.5 w-3.5" />
        {r.kind === "approval" ? "Approval needed" : "Your reply"}
        <span className="font-normal text-muted-foreground">
          {r.node ? `as ${nameOf(r.node)}` : ""} · asked by {nameOf(r.from)}
        </span>
      </p>
      <Clamp text={r.text} />
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={r.kind === "input" ? 3 : 1} placeholder={r.kind === "approval" ? "Note (optional)" : "Reply"} aria-label="Answer" className="text-[13px]" />
      <div className="flex justify-end gap-1.5">
        {r.kind === "approval" ? (
          <>
            <Button size="sm" variant="outline" className="h-7" onClick={() => onAnswer({ approved: false, text })}>
              <X className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            <Button size="sm" className="h-7" onClick={() => onAnswer({ approved: true, text })}>
              <Check className="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
          </>
        ) : (
          <Button size="sm" className="h-7" disabled={!text.trim()} onClick={() => onAnswer({ text })}>
            <Send className="mr-1 h-3.5 w-3.5" /> Send
          </Button>
        )}
      </div>
    </li>
  );
}

export function HumanRequests({ pending, nameOf, onAnswer }: { pending: HumanRequest[]; nameOf: (id: string) => string; onAnswer: (id: string, a: { approved?: boolean; text?: string }) => void }) {
  if (!pending.length) return null;
  return (
    <ul className="max-h-[45%] space-y-2 overflow-y-auto border-b border-border/70 p-3" aria-label="Waiting for you">
      {pending.map((r) => (
        <RequestCard key={r.id} r={r} nameOf={nameOf} onAnswer={(a) => onAnswer(r.id, a)} />
      ))}
    </ul>
  );
}
