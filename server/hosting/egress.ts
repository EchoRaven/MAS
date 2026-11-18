// The egress proxy: how a hosted service reaches the hosts it declared, and
// only those. A service with egress hosts stays on the internal network (no
// route out); its HTTP_PROXY / HTTPS_PROXY point here, at the network's
// gateway, with credentials of its own. The proxy allows CONNECT (HTTPS) and
// plain HTTP to that service's hosts, never to a private or loopback address
// (so not to this server, nor the internal network). A program that ignores
// the proxy settings reaches nothing at all.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { privateIp } from "@/model/net";

interface Grant {
  service: string;
  token: string;
  hosts: string[];
  /** told about every connection, allowed or refused (a run's log) */
  onAccess?: (a: EgressAccess) => void;
}

export interface EgressAccess {
  at: string;
  target: string;
  allowed: boolean;
  why?: string;
}

/** Whether a declared host list allows host:port ("api.github.com", "*.example.com", "host:8443"). */
export function allowed(hosts: string[], host: string, port: number): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return hosts.some((raw) => {
    const [pat, p] = raw.toLowerCase().split(":");
    const portOk = p ? Number(p) === port : port === 443 || port === 80;
    if (!portOk) return false;
    if (pat.startsWith("*.")) return h.endsWith(pat.slice(1)) && h.length > pat.length - 1;
    return h === pat;
  });
}

export class EgressProxy {
  private grants = new Map<string, Grant>();
  private servers: http.Server[] = [];
  /** one listener per address: the shared internal network's gateway, and each compose project's */
  private listening = new Map<string, Promise<{ host: string; port: number }>>();
  /** what was refused, for the service's logs */
  readonly refused: { service: string; target: string; why: string; at: string }[] = [];

  /** Credentials for a service and its hosts; replaces earlier ones for the service. */
  grant(service: string, hosts: string[], onAccess?: (a: EgressAccess) => void): { user: string; token: string } {
    for (const [k, g] of this.grants) if (g.service === service) this.grants.delete(k);
    const token = crypto.randomBytes(18).toString("hex");
    this.grants.set(token, { service, token, hosts, onAccess });
    return { user: service, token };
  }

  private who(req: http.IncomingMessage): Grant | null {
    const h = req.headers["proxy-authorization"];
    if (!h || !h.startsWith("Basic ")) return null;
    const [user, token] = Buffer.from(h.slice(6), "base64").toString().split(":", 2);
    const g = token ? this.grants.get(token) : undefined;
    return g && g.service === user ? g : null;
  }

  /** Resolve and refuse private targets: the proxy must not be a way into this server or the internal network. */
  private async publicAddress(host: string): Promise<string> {
    const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (!ips.length || ips.some(privateIp)) throw new Error(`${host} resolves to a private address`);
    return ips[0];
  }

  private allow(g: Grant, target: string) {
    g.onAccess?.({ at: new Date().toISOString(), target, allowed: true });
  }

  private refuse(service: string, target: string, why: string) {
    for (const g of this.grants.values()) if (g.service === service) g.onAccess?.({ at: new Date().toISOString(), target, allowed: false, why });
    this.refused.push({ service, target, why, at: new Date().toISOString() });
    if (this.refused.length > 500) this.refused.shift();
  }

  /** Start listening (once) on the given address: the internal network's gateway. */
  listen(host: string, port = 0): Promise<{ host: string; port: number }> {
    const known = this.listening.get(host);
    if (known) return known;
    const started = new Promise<{ host: string; port: number }>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        // plain HTTP through the proxy: the request line has the full URL
        const g = this.who(req);
        if (!g) return void (res.writeHead(407, { "proxy-authenticate": 'Basic realm="mas-egress"' }), res.end("proxy credentials required"));
        let url: URL;
        try {
          url = new URL(req.url ?? "");
        } catch {
          return void (res.writeHead(400), res.end("an absolute URL is required"));
        }
        const port = Number(url.port || 80);
        if (!allowed(g.hosts, url.hostname, port)) {
          this.refuse(g.service, `${url.hostname}:${port}`, "not declared");
          return void (res.writeHead(403), res.end(`${url.hostname} is not among this service's egress hosts`));
        }
        try {
          const address = await this.publicAddress(url.hostname);
          this.allow(g, `${url.hostname}:${port}`);
          const headers = { ...req.headers };
          delete headers["proxy-authorization"];
          const up = http.request({ host: address, port, method: req.method, path: url.pathname + url.search, headers: { ...headers, host: url.host } }, (r) => {
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          });
          up.on("error", (e) => (res.headersSent ? res.destroy() : (res.writeHead(502), res.end(e.message))));
          req.pipe(up);
        } catch (e) {
          this.refuse(g.service, url.hostname, (e as Error).message);
          res.writeHead(403);
          res.end((e as Error).message);
        }
      });
      // HTTPS: CONNECT host:port, then a tunnel
      server.on("connect", async (req, socket: net.Socket, head) => {
        const g = this.who(req);
        if (!g) return void socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="mas-egress"\r\n\r\n');
        const [host, p] = (req.url ?? "").split(":");
        const port = Number(p || 443);
        if (!allowed(g.hosts, host, port)) {
          this.refuse(g.service, `${host}:${port}`, "not declared");
          return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        }
        try {
          const address = await this.publicAddress(host);
          this.allow(g, `${host}:${port}`);
          const up = net.connect(port, address, () => {
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) up.write(head);
            up.pipe(socket);
            socket.pipe(up);
          });
          up.on("error", () => socket.destroy());
          socket.on("error", () => up.destroy());
        } catch (e) {
          this.refuse(g.service, host, (e as Error).message);
          socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        }
      });
      server.on("error", reject);
      server.listen(port, host, () => {
        this.servers.push(server);
        resolve({ host, port: (server.address() as net.AddressInfo).port });
      });
    });
    this.listening.set(host, started);
    started.catch(() => this.listening.delete(host));
    return started;
  }

  close() {
    for (const s of this.servers) s.close();
    this.servers = [];
    this.listening.clear();
  }
}
