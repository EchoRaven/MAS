// @vitest-environment node
import { describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import { assertPublicUrl, pinnedGet, privateIp } from "./web";

describe("private addresses", () => {
  it("are recognised in all their usual forms", () => {
    for (const ip of [
      "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.8",
      "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::127.0.0.1", "64:ff9b::7f00:1",
    ]) expect(privateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2001:4860:4860::8888"]) expect(privateIp(ip), ip).toBe(false);
  });

  it("are refused as URLs, by address or by name", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:4311/")).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("http://[::1]:5190/api/health")).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("http://localhost:5190/")).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/only http/);
  });
});

describe("pinned fetching", () => {
  it("connects to the address that was checked, not whatever the name resolves to later", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/zipped") {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(zlib.gzipSync("unzipped fine"));
      } else res.writeHead(200, { "content-type": "text/plain" }).end(`host header: ${req.headers.host}`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      // .invalid never resolves: an answer proves the connection went to the pinned address
      const r = await pinnedGet(new URL(`http://pinned.invalid:${port}/`), "127.0.0.1");
      expect(r.status).toBe(200);
      expect(r.body).toBe(`host header: pinned.invalid:${port}`);
      expect((await pinnedGet(new URL(`http://pinned.invalid:${port}/zipped`), "127.0.0.1")).body).toBe("unzipped fine");
    } finally {
      server.close();
    }
  });
});
