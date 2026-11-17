// Fetching pages for agents. Private, loopback and link-local addresses are
// refused so an agent cannot reach services on the server's own network.
import dns from "node:dns/promises";
import net from "node:net";

function privateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http(s) URLs");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(privateIp)) throw new Error(`refusing to fetch a private address (${host})`);
  return url;
}

export async function fetchText(raw: string, maxChars = 20_000): Promise<string> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "mas-studio/0.1" }, signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    let text = await res.text();
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
