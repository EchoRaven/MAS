import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Database, Flag, Hash, MessageSquareReply, ShieldAlert, ShieldCheck, Sparkles, SquareFunction, UserCheck, Wrench } from "lucide-react";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { cn } from "@/lib/utils";
import { Markdown } from "@/lib/markdown";
import { usd } from "@/lib/format";
import type { SystemDoc } from "@/model/types";
import type { SimEvent } from "@/run/simulate";

export function useNames(doc: SystemDoc) {
  return useMemo(() => {
    const m = new Map(doc.nodes.map((n) => [n.id, { name: "name" in n.data ? n.data.name : n.id, kind: n.data.kind }]));
    const room = new Set(doc.nodes.filter((n) => n.data.kind === "env" && n.data.env_kind === "room").map((n) => n.id));
    return (id: string) => {
      const v = m.get(id) ?? { name: id, kind: "agent" as const };
      return { ...v, room: room.has(id) };
    };
  }, [doc]);
}

/** Long text folds to a few lines with a toggle. */
export function Clamp({ text, lines = 6, className }: { text: string; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420 || text.split("\n").length > lines;
  return (
    <div className={className}>
      <div className={cn("text-[13px]", !open && long && "max-h-[9.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]")}>
        <Markdown text={text} />
      </div>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

export function TimelineItem({ e, nameOf }: { e: SimEvent; nameOf: ReturnType<typeof useNames> }) {
  const time = <span className="text-[11px] text-muted-foreground">t+{e.t.toFixed(1)}s</span>;
  const who = (id: string) => {
    const n = nameOf(id);
    return <EntityAvatar kind={n.kind === "agent" || n.kind === "human" ? "agent" : "system"} id={id} name={n.name} className="h-8 w-8 text-[11px]" />;
  };
  switch (e.type) {
    case "message": {
      const to = nameOf(e.to);
      return (
        <li className="flex gap-3 px-3 py-2">
          {who(e.from)}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold">{nameOf(e.from).name}</span>
              {time}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("rounded-full px-1.5 py-0.5", e.kind === "call" ? "bg-info/10 text-info" : e.kind === "handoff" ? "bg-warning/10 text-warning" : "bg-secondary")}>{e.kind}</span>
              <ArrowRight className="h-3 w-3" />
              {to.room ? (
                <span className="flex items-center">
                  <Hash className="h-3 w-3" />
                  {to.name}
                </span>
              ) : (
                <span>{to.name}</span>
              )}
            </div>
            <Clamp text={e.text} className="mt-1" />
          </div>
        </li>
      );
    }
    case "output":
      return (
        <li className="mx-3 my-2 rounded-lg bg-success/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-success">
            <Flag className="h-3.5 w-3.5" /> Result{nameOf(e.node).kind === "human" ? ` for ${nameOf(e.node).name}` : ` from ${nameOf(e.node).name}`}
            <span className="ml-auto font-normal text-muted-foreground">{time}</span>
          </p>
          <Clamp text={e.text} lines={12} className="mt-1" />
        </li>
      );
    case "log":
      if (e.level === "info")
        return (
          <li className="flex items-center gap-2 px-3 py-1 pl-14 text-xs text-muted-foreground">
            <span className="truncate">{e.node ? `${nameOf(e.node).name}: ` : ""}{e.text}</span>
            <span className="ml-auto shrink-0">{time}</span>
          </li>
        );
      return (
        <li className={cn("mx-3 my-1 flex items-start gap-2 rounded-lg px-3 py-2 text-xs", e.level === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
          {e.level === "error" ? <CircleAlert className="mt-px h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-px h-4 w-4 shrink-0" />}
          <span className="min-w-0 break-words">{e.node ? <span className="font-medium">{nameOf(e.node).name}: </span> : null}{e.text}</span>
          <span className="ml-auto shrink-0">{time}</span>
        </li>
      );
    case "human_request":
      return (
        <li className="mx-3 my-1 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <p className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            {e.request.kind === "approval" ? "Approval" : "Reply"} asked of {e.request.node ? nameOf(e.request.node).name : "you"} by {nameOf(e.request.from).name}
            <span className="ml-auto">{time}</span>
          </p>
          <Clamp text={e.request.text} className="mt-1 text-foreground" />
        </li>
      );
    case "human_response":
      return (
        <li className="flex items-center gap-2 px-3 py-1 pl-14 text-xs text-muted-foreground">
          <MessageSquareReply className="h-3.5 w-3.5" />
          {e.approved === undefined ? "Answered" : e.approved ? "Approved" : "Rejected"}
          {e.text && <span className="truncate text-foreground">“{e.text}”</span>}
        </li>
      );
    case "tool":
      return (
        <li className="flex gap-3 px-3 py-1.5 pl-14">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-secondary/70 px-2.5 py-1.5 font-mono text-xs">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">{e.tool}</span>
            <span className="truncate text-muted-foreground" title={e.args}>{e.args}</span>
            <span className={cn("ml-auto max-w-[45%] shrink-0 truncate", e.error ? "text-destructive" : "text-muted-foreground")} title={e.result}>
              → {e.result}
            </span>
          </div>
        </li>
      );
    case "access":
      return (
        <li className="flex items-center gap-2 px-3 py-1 pl-14 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" /> {nameOf(e.node).name} {e.op === "read" ? "reads" : "writes"} {nameOf(e.target).name}
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "gate":
      return (
        <li className={cn("mx-3 my-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs", e.passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {e.passed ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          <span className="font-medium">Gate {e.gate}</span>
          <span>{e.reason}</span>
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "approval":
      return (
        <li className="mx-3 my-1 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <UserCheck className="h-4 w-4" />
          {e.resolved ? `${nameOf(e.node).name} approved` : `Waiting for ${nameOf(e.node).name} to approve (from ${nameOf(e.from).name})`}
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "spawn":
      return (
        <li className="mx-3 my-1 flex items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-info">
          <Sparkles className="h-4 w-4" />
          {nameOf(e.node).name} spawned {e.count} × "{nameOf(e.template).name}"
          <span className="ml-auto">{time}</span>
        </li>
      );
    case "transform":
      return (
        <li className="flex items-center gap-2 px-3 py-1 pl-14 text-xs text-muted-foreground">
          <SquareFunction className="h-3.5 w-3.5 shrink-0 text-info" />
          <span className="font-medium text-foreground">{e.label}</span>
          <span className="truncate">{e.detail}</span>
          <span className="ml-auto shrink-0">{time}</span>
        </li>
      );
    case "system_finished":
      return (
        <li className="mx-3 my-2 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 text-success" /> System finished: {e.reason}
          <span className="ml-auto">{time}</span>
        </li>
      );
    default:
      return null;
  }
}

export function describe(e: SimEvent, n: (id: string) => string): string {
  switch (e.type) {
    case "system_started":
      return "";
    case "status":
      return `${n(e.node)} → ${e.status}`;
    case "message":
      return `${n(e.from)} → ${n(e.to)} [${e.kind}] ${e.text}`;
    case "tool":
      return `${n(e.node)} ${e.tool}(${e.args}) → ${e.result}`;
    case "access":
      return `${n(e.node)} ${e.op} ${n(e.target)}`;
    case "gate":
      return `${e.gate} ${e.passed ? "passed" : "blocked"}: ${e.reason}`;
    case "approval":
      return `${n(e.node)} ${e.resolved ? "approved" : "requested by " + n(e.from)}`;
    case "usage":
      return `${n(e.node)} in=${e.tokens_in} out=${e.tokens_out} ${usd(e.usd)}${e.estimated ? " (est.)" : ""}`;
    case "spawn":
      return `${n(e.node)} spawned ${e.count}× ${n(e.template)}`;
    case "transform":
      return `${n(e.at)} ${e.label}: ${e.detail}`;
    case "human_request":
      return `${e.request.kind === "approval" ? "Approval" : "Input"} requested of ${n(e.request.node) || "you"} by ${n(e.request.from)}: ${e.request.text}`;
    case "human_response":
      return e.approved === undefined ? `Answered: ${e.text ?? ""}` : `${e.approved ? "Approved" : "Rejected"}${e.text ? `: ${e.text}` : ""}`;
    case "output":
      return `Output from ${n(e.node)}: ${e.text}`;
    case "log":
      return `${e.level}: ${e.node ? n(e.node) + ": " : ""}${e.text}`;
    case "system_finished":
      return e.reason;
  }
}

