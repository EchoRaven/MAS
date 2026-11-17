import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Row = { name: string; source: "store" | "environment" | null; referenced: boolean };

function SecretRow({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await Api.setSecret(row.name, value);
      setValue("");
      setEditing(false);
      setError("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <KeyRound className={cn("h-3.5 w-3.5", row.source ? "text-success" : "text-muted-foreground")} />
      <span className="font-mono text-xs">{row.name}</span>
      <span className="text-[11px] text-muted-foreground">{row.source === "store" ? "set here" : row.source === "environment" ? "from the server's environment" : "not set"}</span>
      <div className="ml-auto flex items-center gap-1.5">
        {editing ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => (e.preventDefault(), void save())}>
            <Input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" aria-label={`Value of ${row.name}`} className="h-7 w-64 font-mono text-xs" autoComplete="off" />
            <Button size="sm" className="h-7" type="submit" disabled={!value}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(true)}>
            {row.source === "store" ? "Replace" : "Set"}
          </Button>
        )}
        {row.source === "store" && !editing && (
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${row.name}`} onClick={async () => (await Api.deleteSecret(row.name), onChanged())}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {error && <p className="w-full text-[12px] text-destructive">{error}</p>}
    </li>
  );
}

export function SecretsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState("");
  const load = useCallback(() => void Api.secrets().then((r) => setRows(r.secrets)).catch(() => setRows([])), []);
  useEffect(load, [load]);
  return (
    <section className="glass-panel rounded-xl p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">API keys and secrets</h2>
        <span className="text-[12px] text-muted-foreground">Systems name a variable (a model's key_env); the value stays on the server and is never sent back.</span>
      </div>
      <ul className="mt-2 divide-y divide-border/70">
        {rows?.map((r) => <SecretRow key={r.name} row={r} onChanged={load} />)}
      </ul>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = adding.trim().toUpperCase();
          if (!name) return;
          setRows((rs) => (rs?.some((r) => r.name === name) ? rs : [...(rs ?? []), { name, source: null, referenced: false }]));
          setAdding("");
        }}
      >
        <Input value={adding} onChange={(e) => setAdding(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} placeholder="NEW_SECRET_NAME" aria-label="New secret name" className="h-7 max-w-56 font-mono text-xs" />
        <Button size="sm" variant="ghost" className="h-7" type="submit" disabled={!adding.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </form>
    </section>
  );
}
