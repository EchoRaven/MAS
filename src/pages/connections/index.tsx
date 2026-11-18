// Connections: everything a system reaches outside the platform's own code.
// Hosted services are projects uploaded here (or cloned from git), built and
// run in Docker on this server; remote endpoints are URLs elsewhere. Either
// can be tested before a component points at it.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Hammer, Loader2, Play, Plug, Square, Trash2, Upload } from "lucide-react";
import { Api, type EndpointTest, type HostedServiceInfo } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ExposeKind, HostManifest } from "@/model/hosting";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";

const EXPOSE: { value: ExposeKind; label: string }[] = [
  { value: "mcp-stdio", label: "MCP over stdio (a fresh container per connection)" },
  { value: "mcp-http", label: "MCP over HTTP (one container, a port)" },
  { value: "http", label: "HTTP API (one container, a port)" },
  { value: "agent-stdio", label: "Agent program (a fresh container per turn)" },
];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function TestResult({ t }: { t: EndpointTest | null }) {
  if (!t) return null;
  return (
    <div className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-[12px]", t.ok ? "bg-emerald-500/10" : "bg-destructive/10 text-destructive")} role="status">
      <p className="flex items-center gap-1.5 font-medium">
        {t.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <CircleAlert className="h-3.5 w-3.5" />}
        {t.ok ? "Connected" : "Failed"} · {t.detail} · {t.ms} ms
      </p>
      {t.tools && t.tools.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {t.tools.map((x) => (
            <li key={x.name}>
              <span className="font-mono text-foreground">{x.name}</span> {x.description && `— ${x.description.slice(0, 120)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServiceRow({ s, onChanged }: { s: HostedServiceInfo; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState("");
  const [test, setTest] = useState<EndpointTest | null>(null);
  const [error, setError] = useState("");
  const v = s.versions.find((x) => x.n === s.current);
  const kind = s.manifest.expose.kind;
  const outbound = (s.manifest.egress ?? []).length > 0;
  const act = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    setError("");
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
    onChanged();
  };
  return (
    <li className="py-3" aria-label={`Service ${s.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{s.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
        <span className="rounded-full bg-secondary px-2 py-px text-[11px]">{kind}</span>
        <span className={cn("rounded-full px-2 py-px text-[11px]", outbound ? "bg-amber-500/15 text-amber-800 dark:text-amber-200" : "bg-secondary")} title={outbound ? "Only these hosts, through the platform's egress proxy (HTTPS_PROXY); nothing else, nothing private" : "No network at all"}>
          {outbound ? `egress: ${s.manifest.egress!.join(", ")}` : "no network"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          v{s.current} · {v?.from === "git" ? v.source : v?.source} · {v?.build_ok ? "built" : v?.built_at ? "build failed" : "not built"}
          {kind !== "mcp-stdio" && kind !== "agent-stdio" && (s.state?.running ? ` · running at ${s.state.address ?? "?"}` : " · stopped")}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => act("build", async () => setLog((await Api.buildHosted(s.id)).log))}>
            {busy === "build" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1 h-3.5 w-3.5" />} Build
          </Button>
          {kind !== "mcp-stdio" && kind !== "agent-stdio" &&
            (s.state?.running ? (
              <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => act("stop", () => Api.stopHosted(s.id))}>
                <Square className="mr-1 h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7" disabled={!!busy || !v?.build_ok} onClick={() => act("start", () => Api.startHosted(s.id))}>
                {busy === "start" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />} Start
              </Button>
            ))}
          {kind !== "agent-stdio" && (
            <Button size="sm" variant="outline" className="h-7" disabled={!!busy || !v?.build_ok} onClick={() => act("test", async () => setTest(await Api.testEndpoint({ hosted: { service: s.id } }, kind === "http" ? "http" : "mcp")))}>
              {busy === "test" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1 h-3.5 w-3.5" />} Test
            </Button>
          )}
          {kind !== "mcp-stdio" && kind !== "agent-stdio" && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => act("logs", async () => setLog((await Api.hostedLogs(s.id)).logs))}>
              Logs
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${s.name}`} onClick={() => window.confirm(`Delete ${s.name}, its versions and images?`) && act("delete", () => Api.deleteHosted(s.id))}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Use it {kind === "agent-stdio" ? "as an agent's program (harness runner custom-stdio)" : "in a component"} as <code className="rounded bg-secondary px-1">endpoint: {`{ hosted: { service: ${s.id} } }`}</code>
        {s.manifest.start && (
          <>
            {" "}· starts with <code className="rounded bg-secondary px-1">{s.manifest.start}</code>
          </>
        )}
      </p>
      {error && <p className="mt-1 text-[12px] text-destructive">{error}</p>}
      <TestResult t={test} />
      {log && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-secondary/60 p-2 text-[11px] leading-snug">{log}</pre>}
    </li>
  );
}

function HostForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [git, setGit] = useState("");
  const [start, setStart] = useState("");
  const [kind, setKind] = useState<ExposeKind>("mcp-stdio");
  const [port, setPort] = useState("");
  const [service, setService] = useState("");
  const [egress, setEgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const manifest: Partial<HostManifest> = { expose: { kind, ...(port ? { port: Number(port) } : {}), ...(service.trim() ? { service: service.trim() } : {}) }, ...(start.trim() ? { start: start.trim() } : {}), egress: egress.split(/[\s,]+/).filter(Boolean) };
      await Api.createHosted({ name: name.trim(), manifest, ...(file ? { archive_base64: await readAsBase64(file), filename: file.name } : { git: git.trim() }) });
      setName("");
      setFile(null);
      setGit("");
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <form className="mt-3 grid gap-2 rounded-lg border border-border/70 p-3 text-xs md:grid-cols-2" onSubmit={(e) => (e.preventDefault(), void submit())} aria-label="Host a project">
      <label className="flex flex-col gap-1 text-muted-foreground">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notes MCP" className="h-8 text-xs" aria-label="Service name" />
      </label>
      <div className="flex flex-col gap-1 text-muted-foreground">
        Code: an archive, or a git repository
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1.5 hover:bg-secondary/60">
            <Upload className="h-3.5 w-3.5" /> {file ? file.name : ".tar.gz / .zip"}
            <input type="file" accept=".tar.gz,.tgz,.zip" className="hidden" aria-label="Project archive" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setGit(""))} />
          </label>
          <span>or</span>
          <Input value={git} onChange={(e) => (setGit(e.target.value), setFile(null))} placeholder="https://github.com/…" className="h-8 flex-1 text-xs" aria-label="Git URL" />
        </div>
      </div>
      <label className="flex flex-col gap-1 text-muted-foreground">
        Start command (or in mas-host.yaml)
        <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="python server.py" className="h-8 font-mono text-xs" aria-label="Start command" />
      </label>
      <label className="flex flex-col gap-1 text-muted-foreground">
        Exposes
        <Select value={kind} onValueChange={(v) => setKind(v as ExposeKind)} items={EXPOSE} ariaLabel="Exposes" />
      </label>
      {kind !== "mcp-stdio" && kind !== "agent-stdio" && (
        <label className="flex flex-col gap-1 text-muted-foreground">
          Port it listens on
          <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} placeholder="8000" className="h-8 text-xs" aria-label="Port" />
        </label>
      )}
      {kind !== "mcp-stdio" && kind !== "agent-stdio" && (
        <label className="flex flex-col gap-1 text-muted-foreground">
          Compose service (if the project has a compose file)
          <Input value={service} onChange={(e) => setService(e.target.value.replace(/[^A-Za-z0-9_.-]/g, ""))} placeholder="api" className="h-8 font-mono text-xs" aria-label="Compose service" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-muted-foreground">
        Network: hosts it needs (empty = no network)
        <Input value={egress} onChange={(e) => setEgress(e.target.value)} placeholder="api.github.com" className="h-8 font-mono text-xs" aria-label="Egress hosts" />
      </label>
      <div className="flex items-center gap-2 md:col-span-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim() || (!file && !git.trim())}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />} Host it
        </Button>
        <span className="text-[11px] text-muted-foreground">Then Build. Listed hosts are reached through the platform's egress proxy (HTTPS_PROXY), and only they; "*.example.com" covers subdomains.</span>
      </div>
      {error && <p className="text-[12px] text-destructive md:col-span-2">{error}</p>}
    </form>
  );
}

function RemoteTest() {
  const [url, setUrl] = useState("");
  const [bearer, setBearer] = useState("");
  const [kind, setKind] = useState<"mcp" | "http">("mcp");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<EndpointTest | null>(null);
  return (
    <section className="glass-panel rounded-xl p-4" aria-label="Remote endpoints">
      <h2 className="text-sm font-semibold">Remote endpoints</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        A server somewhere else. Components point at it with <code className="rounded bg-secondary px-1">{"endpoint: { remote: { url, bearer_env } }"}</code>; the token is a secret named in Settings, sent as a bearer token.
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setTest(await Api.testEndpoint({ remote: { url: url.trim(), ...(bearer.trim() ? { bearer_env: bearer.trim() } : {}) } }, kind).catch((err) => ({ ok: false, detail: (err as Error).message, ms: 0 })));
          setBusy(false);
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" className="h-8 min-w-64 flex-1 text-xs" aria-label="Remote URL" />
        <Input value={bearer} onChange={(e) => setBearer(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} placeholder="SECRET_NAME (optional)" className="h-8 w-48 font-mono text-xs" aria-label="Bearer secret" />
        <Select value={kind} onValueChange={(v) => setKind(v as "mcp" | "http")} items={[{ value: "mcp", label: "MCP" }, { value: "http", label: "HTTP" }]} ariaLabel="Kind" size="sm" />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !/^https?:\/\//.test(url.trim())}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1 h-3.5 w-3.5" />} Test
        </Button>
      </form>
      <TestResult t={test} />
    </section>
  );
}

export function ConnectionsPage() {
  const connected = useServer((s) => s.status === "connected");
  const [services, setServices] = useState<HostedServiceInfo[] | null>(null);
  const load = useCallback(() => void Api.hostedServices().then((r) => setServices(r.services)).catch(() => setServices([])), []);
  useEffect(() => {
    if (connected) load();
  }, [connected, load]);
  if (!connected)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Connections live on the server. <Link to="/settings" className="text-primary underline">Connect to it in Settings</Link>.
      </div>
    );
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="mx-auto max-w-5xl space-y-3">
        <section className="glass-panel rounded-xl p-4" aria-label="Hosted services">
          <h2 className="text-sm font-semibold">Hosted services</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Projects run on this server, each in its own Docker container: an MCP server, a plugin backend or a tool. Upload an archive or give a git URL; a compose project runs as a whole (rewritten: no published ports, one internal network), a Dockerfile is used as it is, otherwise Python (requirements.txt / pyproject.toml) or Node (package.json) is set up for you. No network unless the service lists the hosts it needs.
          </p>
          <HostForm onCreated={load} />
          <ul className="mt-2 divide-y divide-border/70">
            {services?.map((s) => <ServiceRow key={s.id} s={s} onChanged={load} />)}
            {services && services.length === 0 && <li className="py-3 text-[12px] text-muted-foreground">Nothing hosted yet.</li>}
          </ul>
        </section>
        <RemoteTest />
      </div>
    </div>
  );
}
