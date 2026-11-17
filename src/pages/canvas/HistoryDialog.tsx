// Earlier versions of the system, kept by the server as it is edited, and
// putting one back. Restoring keeps the current version first, so it can be undone.
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Api, type SystemVersion } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { timeAgo } from "@/lib/format";
import type { SystemDoc } from "@/model/types";

export function HistoryDialog({ open, onClose, doc, onRestore }: { open: boolean; onClose: () => void; doc: SystemDoc; onRestore: (doc: SystemDoc) => void }) {
  const [versions, setVersions] = useState<SystemVersion[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setError("");
    Api.versions(doc.id)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError(e.message));
  }, [open, doc.id]);

  const restore = async (v: SystemVersion) => {
    setBusy(v.version);
    try {
      onRestore(await Api.restoreVersion(doc.id, v.version));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>Earlier versions of this system, kept every few minutes while it is edited. Restoring one keeps the current version here too, so you can go back.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!versions && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {versions?.length === 0 && <p className="text-sm text-muted-foreground">No earlier versions yet. One is kept the first time this system is changed, then every few minutes of editing.</p>}
        {versions && versions.length > 0 && (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={new Date(v.saved_at).toLocaleString()}>
                    {timeAgo(new Date(v.saved_at).toISOString())}
                    {v.name !== doc.name && <span className="font-normal text-muted-foreground"> · named “{v.name}”</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {v.nodes} component{v.nodes === 1 ? "" : "s"} · {v.edges} connection{v.edges === 1 ? "" : "s"}
                    {v.nodes !== doc.nodes.length || v.edges !== doc.edges.length ? ` (now ${doc.nodes.length} · ${doc.edges.length})` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void restore(v)} aria-label={`Restore the version from ${timeAgo(new Date(v.saved_at).toISOString())}`}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {busy === v.version ? "Restoring…" : "Restore"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
