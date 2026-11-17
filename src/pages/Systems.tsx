import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, Copy, Download, MoreHorizontal, PlayCircle, Plus, Search, Trash2, Upload, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/EmptyState";
import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { downloadText, slug, timeAgo } from "@/lib/format";
import { TEMPLATES } from "@/model/templates";
import type { SystemDoc } from "@/model/types";
import { validate } from "@/model/validate";
import { conformSystem } from "@/model/conformance";
import { fromYaml, toYaml } from "@/model/yaml";
import { useSystems } from "@/store/systems";

function counts(doc: SystemDoc) {
  const c = (k: string) => doc.nodes.filter((n) => n.data.kind === k).length;
  return { agents: c("agent"), humans: c("human"), envs: c("env"), stores: c("store"), rooms: c("channel"), groups: c("group"), edges: doc.edges.length };
}

function SystemCard({ doc }: { doc: SystemDoc }) {
  const navigate = useNavigate();
  const { duplicate, remove } = useSystems();
  const [confirm, setConfirm] = useState(false);
  const k = counts(doc);
  const issues = validate(doc);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const agentNames = doc.nodes.filter((n) => n.data.kind === "agent").slice(0, 5);

  return (
    <article className="glass-panel group flex flex-col rounded-xl p-4">
      <div className="flex items-start gap-3">
        <EntityAvatar kind="run" id={doc.id} name={doc.name} />
        <div className="min-w-0 flex-1">
          <Link to={`/canvas/${doc.id}`} className="block truncate font-semibold hover:underline">
            {doc.name}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{doc.description || "No description"}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${doc.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => downloadText(`${slug(doc.name)}.mas.yaml`, toYaml(doc))}>
              <Download className="mr-2 h-4 w-4" /> Export YAML
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const copy = duplicate(doc.id);
                if (copy) navigate(`/canvas/${copy.id}`);
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirm(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {[
          [k.agents, "agent"],
          [k.humans, "human"],
          [k.envs, "env"],
          [k.stores, "store"],
          [k.rooms, "room"],
          [k.groups, "group"],
        ]
          .filter(([n]) => Number(n) > 0)
          .map(([n, label]) => (
            <span key={String(label)} className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
              {n} {label}
            </span>
          ))}
        {errors > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">{errors} errors</span>}
        {warnings > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">{warnings} warnings</span>}
      </div>

      <div className="mt-3 flex -space-x-1.5">
        {agentNames.map((n) => (
          <EntityAvatar key={n.id} kind="agent" id={n.id} name={"name" in n.data ? n.data.name : n.id} className="h-7 w-7 text-[10px] ring-2 ring-card" />
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="text-xs text-muted-foreground">Updated {timeAgo(doc.updated_at)}</span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/runs/${doc.id}`}>
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Simulate
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to={`/canvas/${doc.id}`}>
              <Workflow className="mr-1.5 h-3.5 w-3.5" /> Open canvas
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{doc.name}"?</DialogTitle>
            <DialogDescription>This can't be undone. Export the YAML first if you want a backup.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => remove(doc.id)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function SystemsPage() {
  const systems = useSystems((s) => s.systems);
  const create = useSystems((s) => s.create);
  const importDoc = useSystems((s) => s.importDoc);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = systems.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));

  const onImport = async (file: File) => {
    try {
      const parsed = fromYaml(await file.text());
      // every agent, plugin, function and imported env in the file must meet its contract
      const failing = conformSystem(parsed)
        .filter((x) => !x.report.passed)
        .map((x) => `${x.name} (${x.report.contract}): ${x.report.rules.filter((r) => !r.ok && r.severity === "error").map((r) => r.label + (r.detail ? ` — ${r.detail}` : "")).join("; ")}`);
      if (failing.length) throw new Error(`Not imported: ${failing.length} component${failing.length > 1 ? "s do" : " does"} not conform. ${failing.join(" | ")}`);
      const doc = importDoc(parsed);
      setImportError(null);
      navigate(`/canvas/${doc.id}`);
    } catch (err) {
      setImportError((err as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search systems…" className="h-9 pl-9" aria-label="Search systems" />
          </div>
          <input ref={fileRef} type="file" accept=".yaml,.yml" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> Import YAML
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" /> New system
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => navigate(`/canvas/${create(t.id).id}`)} className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.summary}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {importError && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Import failed: {importError}</p>}

        {shown.length === 0 ? (
          <div className="mt-16">
            <EmptyState icon={Boxes} title={q ? "No matching systems" : "No systems yet"} subtitle="Create one from the top right, or import YAML" />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((doc) => (
              <SystemCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
