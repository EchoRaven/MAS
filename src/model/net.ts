// Which addresses count as local or private: this machine, private networks,
// link-local (cloud metadata) and the special ranges. Shared by the server
// (which refuses to fetch them) and the validator (which flags systems that
// reach them). No Node imports, so it runs in the browser too.

const isV4 = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((x) => Number(x) <= 255);
const isV6 = (s: string) => s.includes(":") && /^[0-9a-f:.]+$/i.test(s);

/** The IPv4 address an IPv6 one carries, if any: ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::/96 (NAT64), dotted or hex. */
function embeddedV4(v6: string): string | null {
  const v = v6.toLowerCase();
  const prefix = /^(?:::ffff:|::|64:ff9b::)(.*)$/.exec(v);
  if (!prefix) return null;
  const rest = prefix[1];
  if (isV4(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** Addresses an agent must not reach: this machine, private networks, link-local (cloud metadata), and the special ranges. */
export function privateIp(ip: string): boolean {
  if (isV6(ip)) {
    const v = ip.toLowerCase();
    const v4 = embeddedV4(v);
    if (v4) return privateIp(v4);
    return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** A URL that points at this machine or a private network, judged from its text (no lookup). */
export function localUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return host;
  if ((isV4(host) || isV6(host)) && privateIp(host)) return host;
  return null;
}
