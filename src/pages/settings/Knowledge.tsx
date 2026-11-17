import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);

/** The server's knowledge folder: knowledge plugins index the paths in their sources from here. */
export function KnowledgeSection() {
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [folder, setFolder] = useState("docs");
  const [error, setError] = useState("");
  const load = useCallback(() => void Api.knowledge().then((r) => setFiles(r.files)).catch((e) => setError(e.message)), []);
  useEffect(load, [load]);
  const upload = async (list: FileList | null) => {
    if (!list) return;
    setError("");
    try {
      for (const f of Array.from(list)) await Api.putKnowledge(`${folder.replace(/^\/+|\/+$/g, "")}/${f.name}`.replace(/^\//, ""), f);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="glass-panel rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Knowledge files</h2>
        <span className="text-[12px] text-muted-foreground">A knowledge plugin with source "docs" indexes the docs folder here.</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" className="h-7 w-32 font-mono text-xs" />
          <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium shadow-[var(--ring-shadow)] hover:bg-secondary">
            <Upload className="h-3.5 w-3.5" /> Upload
            <input type="file" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} accept=".md,.txt,.html,.htm,.json,.csv,.yaml,.yml,.rst,.py,.ts,.js,.sql,.xml" />
          </label>
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      <ul className="mt-2 max-h-72 divide-y divide-border/70 overflow-y-auto">
        {files.length === 0 && <li className="py-3 text-[13px] text-muted-foreground">No files yet.</li>}
        {files.map((f) => (
          <li key={f.path} className="flex items-center gap-2 py-1.5 text-[13px]">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-xs">{f.path}</span>
            <span className="text-[11px] text-muted-foreground">{size(f.size)}</span>
            <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label={`Delete ${f.path}`} onClick={async () => (await Api.deleteKnowledge(f.path), load())}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
