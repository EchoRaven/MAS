import { useState } from "react";
import { PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useServer } from "@/store/server";

const STATUS: Record<string, { label: string; tone: string }> = {
  checking: { label: "Checking…", tone: "pending" },
  offline: { label: "Not running", tone: "stopped" },
  needs_token: { label: "Needs a token", tone: "paused" },
  connected: { label: "Connected", tone: "completed" },
};

export function ServerSection() {
  const { status, error, connect, disconnect, check, localExec } = useServer();
  const [token, setTokenText] = useState("");
  const [busy, setBusy] = useState(false);
  const s = STATUS[status];
  return (
    <section className="glass-panel space-y-3 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Server</h2>
        <StatusBadge status={s.tone} label={s.label} />
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => void check()}>
          Check again
        </Button>
      </div>
      {status === "offline" && (
        <p className="text-[13px] text-muted-foreground">
          Start it with <code className="rounded bg-secondary px-1 font-mono text-xs">npm run server</code>. Until then systems stay in this browser and runs are simulated.
        </p>
      )}
      {status === "needs_token" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await connect(token);
            setBusy(false);
          }}
        >
          <Input type="password" value={token} onChange={(e) => setTokenText(e.target.value)} placeholder="Server token" aria-label="Server token" className="h-8 max-w-sm font-mono text-xs" autoComplete="off" />
          <Button size="sm" type="submit" disabled={!token.trim() || busy}>
            <PlugZap className="mr-1.5 h-3.5 w-3.5" /> Connect
          </Button>
          <p className="w-full text-[12px] text-muted-foreground">The token is in the server's data folder (.data/token), or whatever MAS_TOKEN was set to.</p>
        </form>
      )}
      {status === "connected" && (
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-muted-foreground">Systems sync to the server; runs call real models.</span>
          <span className="text-muted-foreground">Host commands: {localExec ? "allowed" : "off (sandboxes use Docker)"}</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={disconnect}>
            <Unplug className="mr-1.5 h-3.5 w-3.5" /> Forget token
          </Button>
        </div>
      )}
      {error && status !== "connected" && <p className="text-[12px] text-destructive">{error}</p>}
    </section>
  );
}
