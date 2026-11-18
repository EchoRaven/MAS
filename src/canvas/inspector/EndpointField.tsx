// Where an outside server is: on the host (the older url / command fields), a
// remote endpoint (a URL with a bearer secret), or a hosted service picked from
// the Connections page. With a test that lists an MCP server's tools, or calls
// an HTTP service.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Loader2, Plug } from "lucide-react";
import { Api, type EndpointTest, type HostedServiceInfo } from "@/api/client";
import type { Endpoint } from "@/model/hosting";
import { cn } from "@/lib/utils";
import { useServer } from "@/store/server";
import { Hint, opts, SelectField, TextField } from "../fields";

type Where = "host" | "remote" | "hosted";

export function EndpointField({ value, onChange, kind, legacy }: { value: Endpoint | undefined; onChange: (e: Endpoint | undefined) => void; kind: "mcp" | "http"; legacy?: React.ReactNode }) {
  const connected = useServer((s) => s.status === "connected");
  const [services, setServices] = useState<HostedServiceInfo[] | null>(null);
  const [test, setTest] = useState<EndpointTest | null>(null);
  const [busy, setBusy] = useState(false);
  const where: Where = !value ? "host" : "remote" in value ? "remote" : "hosted";
  useEffect(() => {
    if (connected && where === "hosted" && !services) void Api.hostedServices().then((r) => setServices(r.services)).catch(() => setServices([]));
  }, [connected, where, services]);
  // the services that speak what this component needs
  const fitting = (services ?? []).filter((s) => (kind === "mcp" ? s.manifest.expose.kind !== "http" : s.manifest.expose.kind === "http"));
  const run = async () => {
    if (!value) return;
    setBusy(true);
    setTest(await Api.testEndpoint(value, kind).catch((e) => ({ ok: false, detail: (e as Error).message, ms: 0 })));
    setBusy(false);
  };
  return (
    <>
      <SelectField
        label="Where"
        value={where}
        onChange={(w: Where) => {
          setTest(null);
          onChange(w === "host" ? undefined : w === "remote" ? { remote: { url: "" } } : { hosted: { service: "" } });
        }}
        items={opts([
          ["host", "URL or command (on this machine)"],
          ["remote", "Remote endpoint (URL + secret)"],
          ["hosted", "Hosted service (Connections)"],
        ])}
      />
      {where === "host" && legacy}
      {value && "remote" in value && (
        <>
          <TextField label="URL" value={value.remote.url} onChange={(url) => onChange({ remote: { ...value.remote, url } })} mono placeholder={kind === "mcp" ? "https://example.com/mcp" : "https://example.com/api"} />
          <TextField label="Bearer secret" value={value.remote.bearer_env ?? ""} onChange={(b) => onChange({ remote: { ...value.remote, bearer_env: b.replace(/[^A-Za-z0-9_]/g, "") || undefined } })} mono placeholder="SECRET_NAME (optional)" hint="A secret set in Settings, sent as a bearer token" />
        </>
      )}
      {value && "hosted" in value && (
        <>
          <SelectField
            label="Service"
            value={value.hosted.service || "none"}
            onChange={(service: string) => onChange({ hosted: { ...value.hosted, service: service === "none" ? "" : service } })}
            items={[{ value: "none", label: services ? (fitting.length ? "Choose a service" : `No ${kind === "mcp" ? "MCP" : "HTTP"} service hosted`) : "Loading…" }, ...fitting.map((s) => ({ value: s.id, label: s.name, hint: `${s.manifest.expose.kind} · v${s.current}` }))]}
          />
          <Hint>
            Host a project on the <Link to="/connections" className="text-primary underline">Connections</Link> page: it runs in its own container, with no network unless it declares hosts.
          </Hint>
        </>
      )}
      {value && (
        <div className="flex items-center gap-2 px-1">
          <button type="button" onClick={() => void run()} disabled={busy || ("remote" in value ? !/^https?:\/\//.test(value.remote.url) : !value.hosted.service)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary/60 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} Test the connection
          </button>
          {test && (
            <span className={cn("flex items-center gap-1 text-[11px]", test.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")} role="status">
              {test.ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
              {test.detail}
              {test.tools?.length ? `: ${test.tools.map((t) => t.name).join(", ")}` : ""}
            </span>
          )}
        </div>
      )}
    </>
  );
}
