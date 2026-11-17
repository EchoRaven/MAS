// Fetching pages for agents. Private, loopback and link-local addresses are
// refused so an agent cannot reach services on the server's own network.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { privateIp } from "@/model/net";

export { privateIp };

/** The URL and the public address it will be fetched from (every address the name has must be public). */
export async function resolvePublic(raw: string): Promise<{ url: URL; ip: string }> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http(s) URLs");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(privateIp)) throw new Error(`refusing to fetch a private address (${host})`);
  return { url, ip: ips[0] };
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  return (await resolvePublic(raw)).url;
}

const MAX_BODY = 5_000_000;

/**
 * A GET that connects to exactly `ip`, never to what the name resolves to
 * later: a name that answered a public address to the check cannot answer a
 * private one to the connection (DNS rebinding). HTTPS still verifies the
 * certificate against the host name.
 */
export function pinnedGet(url: URL, ip: string, timeoutMs = 20_000): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const family = net.isIPv6(ip) ? 6 : 4;
  const lookup = ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    opts?.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family)) as unknown as net.LookupFunction;
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: "GET", lookup, headers: { "user-agent": "mas-studio/0.1", "accept-encoding": "gzip, deflate, br" }, timeout: timeoutMs }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "");
      const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.destroy(new Error("the page is too large"));
          return;
        }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchText(raw: string, maxChars = 20_000): Promise<string> {
  let target = await resolvePublic(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await pinnedGet(target.url, target.ip);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      // every hop is checked and pinned again
      target = await resolvePublic(new URL(location, target.url).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers["content-type"] ?? "");
    let text = res.body;
    if (type.includes("html")) {
      text = text
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<(br|p|div|li|h\d)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .trim();
    }
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
  }
  throw new Error("too many redirects");
}
