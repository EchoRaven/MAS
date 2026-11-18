// Hosting a Docker Compose project (an application env: an app, its database,
// its MCP server…). A compose file can ask for far more than one container
// should get, so it is rewritten before it runs:
//   refused   privileged, host network / pid / ipc, cap_add, devices, mounts of
//             paths outside the project, security_opt that loosens confinement
//   removed   published ports (ports:), container_name (would clash), restart
//   added     one internal network for the whole project (services reach each
//             other by name, this server reaches the entry service by its
//             address, nothing reaches out), no-new-privileges, a memory limit
import path from "node:path";

export interface ComposeCheck {
  ok: boolean;
  /** why it cannot run, for the person who uploaded it */
  refused: string[];
  /** what was changed, so they know */
  changed: string[];
  /** the compose file to run, when ok */
  doc?: Record<string, unknown>;
  services: string[];
}

type Svc = Record<string, unknown>;

/** Whether a volume's host side stays inside the project folder. */
function insideProject(src: string): boolean {
  if (!src.startsWith(".") && !src.startsWith("/") && !src.startsWith("~") && !src.includes("/")) return true; // a named volume
  if (src.startsWith("/") || src.startsWith("~") || src.includes("$")) return false;
  const norm = path.posix.normalize(src);
  return !norm.startsWith("..");
}

export function sanitizeCompose(raw: unknown, opts: { memory?: string } = {}): ComposeCheck {
  const refused: string[] = [];
  const changed: string[] = [];
  if (!raw || typeof raw !== "object" || !("services" in raw)) return { ok: false, refused: ["the compose file has no services"], changed, services: [] };
  const src = raw as { services: Record<string, Svc>; networks?: unknown; volumes?: unknown };
  const services: Record<string, Svc> = {};
  for (const [name, s0] of Object.entries(src.services ?? {})) {
    const s: Svc = { ...(s0 ?? {}) };
    const where = `service ${name}`;
    if (s.privileged) refused.push(`${where}: privileged`);
    for (const k of ["network_mode", "pid", "ipc", "userns_mode", "cgroup_parent"]) {
      if (s[k] !== undefined && String(s[k]) !== "") {
        if (k === "network_mode" && /^service:/.test(String(s[k]))) continue;
        refused.push(`${where}: ${k}: ${String(s[k])}`);
      }
    }
    if (Array.isArray(s.cap_add) && s.cap_add.length) refused.push(`${where}: cap_add ${s.cap_add.join(", ")}`);
    if (s.devices) refused.push(`${where}: devices`);
    if (Array.isArray(s.security_opt) && s.security_opt.some((o) => /unconfined|disable/i.test(String(o)))) refused.push(`${where}: security_opt loosens confinement`);
    for (const v of (Array.isArray(s.volumes) ? s.volumes : []) as unknown[]) {
      const hostSide = typeof v === "string" ? v.split(":")[0] : v && typeof v === "object" ? String((v as { source?: string }).source ?? "") : "";
      const kind = v && typeof v === "object" ? (v as { type?: string }).type : undefined;
      if (kind === "tmpfs") continue;
      if (hostSide && !insideProject(hostSide)) refused.push(`${where}: mounts ${hostSide}, outside the project`);
      if (/docker\.sock/.test(hostSide)) refused.push(`${where}: mounts the Docker socket`);
    }
    for (const k of ["ports", "container_name", "restart", "networks", "extra_hosts", "dns"]) {
      if (s[k] !== undefined) {
        delete s[k];
        changed.push(`${where}: ${k} removed`);
      }
    }
    s.networks = ["mas"];
    s.security_opt = [...((Array.isArray(s0?.security_opt) ? s0.security_opt : []) as string[]).filter((o) => !/unconfined|disable/i.test(String(o))), "no-new-privileges:true"];
    s.mem_limit = (s0?.mem_limit as string | undefined) ?? opts.memory ?? "512m";
    s.pids_limit = 256;
    services[name] = s;
  }
  if (!Object.keys(services).length) refused.push("the compose file has no services");
  if (src.networks) changed.push("its own networks replaced by one internal network");
  const doc: Record<string, unknown> = { services, networks: { mas: { internal: true } } };
  // named volumes stay: they live in Docker, inside this project
  if (src.volumes && typeof src.volumes === "object") {
    const vols: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.volumes as Record<string, unknown>)) {
      if (v && typeof v === "object" && ((v as { external?: unknown }).external || (v as { driver_opts?: unknown }).driver_opts)) refused.push(`volume ${k}: external or with driver options`);
      else vols[k] = v ?? {};
    }
    doc.volumes = vols;
  }
  return { ok: refused.length === 0, refused, changed, services: Object.keys(services), ...(refused.length ? {} : { doc }) };
}
