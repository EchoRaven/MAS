// A tiny router over node:http: JSON in and out, path params, bearer auth.
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./store/files";

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  raw: IncomingMessage;
  body(): Promise<unknown>;
  text(): Promise<string>;
}

type Handler = (req: Req, res: ServerResponse) => Promise<unknown> | unknown;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
  auth: boolean;
}

const MAX_BODY = 20 * 1024 * 1024;

function readBody(raw: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    raw.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Body too large"));
        raw.destroy();
      } else chunks.push(c);
    });
    raw.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    raw.on("error", reject);
  });
}

export function sameToken(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export class Router {
  private routes: Route[] = [];
  constructor(private token: string) {}

  on(method: string, pattern: string, handler: Handler, opts: { auth?: boolean } = {}) {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)\*?/g, (m, k) => (keys.push(k), m.endsWith("*") ? "(.+)" : "([^/]+)")) + "/?$");
    this.routes.push({ method, re, keys, handler, auth: opts.auth ?? true });
    return this;
  }

  private authorized(req: Req): boolean {
    const h = req.headers.authorization ?? "";
    // only in the header: a token in the URL ends up in logs and browser history
    const given = h.startsWith("Bearer ") ? h.slice(7) : "";
    return !!given && sameToken(given, this.token);
  }

  async handle(raw: IncomingMessage, res: ServerResponse) {
    const url = new URL(raw.url ?? "/", "http://localhost");
    let text: Promise<string> | undefined;
    const req: Req = {
      method: raw.method ?? "GET",
      path: url.pathname,
      params: {},
      query: url.searchParams,
      headers: raw.headers,
      raw,
      text: () => (text ??= readBody(raw)),
      body: async () => {
        const t = await req.text();
        if (!t) return {};
        try {
          return JSON.parse(t);
        } catch {
          throw new HttpError(400, "Body is not JSON");
        }
      },
    };
    try {
      const route = this.routes.find((r) => r.method === req.method && r.re.test(req.path));
      if (!route) throw new HttpError(404, `No route ${req.method} ${req.path}`);
      const m = route.re.exec(req.path)!;
      route.keys.forEach((k, i) => {
        try {
          req.params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          throw new HttpError(400, "Malformed path");
        }
      });
      if (route.auth && !this.authorized(req)) throw new HttpError(401, "Missing or wrong token");
      const out = await route.handler(req, res);
      if (res.writableEnded || res.headersSent) return;
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: (e as Error).message });
      else res.end();
    }
  }
}

export function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}
