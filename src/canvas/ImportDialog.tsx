import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_EXAMPLE, parseAgentFile } from "@/model/agentspec";
import { checkContract, envFromManifest, parseEnvFile } from "@/model/envspec";
import { parsePluginFile, PLUGIN_EXAMPLE } from "@/model/plugins";
import type { NodeData, NodeKind } from "@/model/types";
import type { Issue } from "@/model/validate";
import { IssueList } from "./inspector/shared";
import type { ImportKind } from "./Palette";

interface Candidate {
  label: string;
  kind: NodeKind;
  data: NodeData;
  issues: Issue[];
}

interface Parsed {
  detected: string;
  notes: string[];
  candidates: Candidate[];
}

const COPY: Record<ImportKind, { title: string; accepts: string; formats: string[]; example: string }> = {
  agent: {
    title: "Import an agent",
    accepts: ".md,.json,.yaml,.yml",
    formats: ["mas-agent/1 manifest", "Claude Code subagent (.md)", "A2A Agent Card (.json)", "langgraph.json"],
    example: AGENT_EXAMPLE,
  },
  env: {
    title: "Import an environment",
    accepts: ".yaml,.yml,.json",
    formats: ["mas-env/1 manifest", "DT registry.yaml", "docker-compose.yml", "env-gen / DT folder → node scripts/import-env.mjs <dir>"],
    example: "contract: mas-env/1\nname: My app\nkind: web_app\nlifecycle:\n  start: docker compose up -d\n  health: GET http://127.0.0.1:8078/health\n  reset: POST http://127.0.0.1:8078/api/v1/reset\nexposes:\n  http: [{ name: api, base: http://127.0.0.1:8078 }]\n  mcp: { transport: http, url: http://127.0.0.1:8890/mcp, auth: none, tools: [get_items] }\n",
  },
  plugin: {
    title: "Import a plugin",
    accepts: ".yaml,.yml,.json",
    formats: ["mas-plugin/1 manifest: tools + hooks + backend"],
    example: PLUGIN_EXAMPLE,
  },
};

function parse(kind: ImportKind, text: string, filename: string): Parsed {
  if (kind === "agent") {
    const r = parseAgentFile(text, filename);
    return { detected: r.detected, notes: r.notes, candidates: [{ label: r.agent.name, kind: "agent", data: r.agent, issues: [] }] };
  }
  if (kind === "plugin") {
    const p = parsePluginFile(text);
    return { detected: "mas-plugin/1", notes: [`${p.spec.tools.length} tools · backend ${p.spec.backend.kind}`], candidates: [{ label: p.name, kind: "plugin", data: p, issues: [] }] };
  }
  const r = parseEnvFile(text, filename);
  return {
    detected: r.detected,
    notes: r.notes,
    candidates: r.manifests.map((m) => ({ label: m.name, kind: "env" as const, data: envFromManifest(m), issues: checkContract(m) })),
  };
}

export function ImportDialog({ kind, onClose, onImport }: { kind: ImportKind | null; onClose: () => void; onImport: (items: { kind: NodeKind; data: NodeData }[]) => void }) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("pasted");
  /** null = everything importable is chosen */
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const copy = kind ? COPY[kind] : null;

  const result = useMemo((): { ok: Parsed } | { error: string } | null => {
    if (!kind || !text.trim()) return null;
    try {
      return { ok: parse(kind, text, filename) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [kind, text, filename]);

  const close = () => {
    setText("");
    setChosen(null);
    onClose();
  };
  const blocked = (c: Candidate) => c.issues.some((i) => i.severity === "error");
  const isChosen = (i: number) => chosen === null || chosen.has(i);
  const picks = result && "ok" in result ? result.ok.candidates.filter((c, i) => isChosen(i) && !blocked(c)) : [];

  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>Accepts: {copy?.formats.join(" · ")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs shadow-[var(--ring-shadow)] hover:bg-secondary">
            <FileUp className="h-3.5 w-3.5" /> Choose file
            <input
              type="file"
              accept={copy?.accepts}
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFilename(f.name);
                setText(await f.text());
                setChosen(null);
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">or paste below</span>
          <button type="button" className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setFilename("example"); setText(copy?.example ?? ""); }}>
            Use an example
          </button>
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} aria-label="Import text" className="font-mono text-xs" />
        {result && "error" in result && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{result.error}</p>}
        {result && "ok" in result && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Detected <span className="font-medium text-foreground">{result.ok.detected}</span>
            </p>
            {result.ok.notes.map((n, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {result.ok.candidates.map((c, i) => (
                <li key={i} className="space-y-1.5 rounded-lg p-2.5 shadow-[0_0_0_1px_hsl(var(--border))]">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    {result.ok.candidates.length > 1 && (
                      <input
                        type="checkbox"
                        checked={isChosen(i) && !blocked(c)}
                        disabled={blocked(c)}
                        onChange={(e) =>
                          setChosen((s) => {
                            const n = new Set(s ?? result.ok.candidates.map((_, j) => j));
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            return n;
                          })
                        }
                      />
                    )}
                    {c.label}
                  </label>
                  <IssueList issues={c.issues} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!picks.length} onClick={() => { onImport(picks.map((c) => ({ kind: c.kind, data: c.data }))); close(); }}>
            Add {picks.length > 1 ? `${picks.length} ` : ""}to canvas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
