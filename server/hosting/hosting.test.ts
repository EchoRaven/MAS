// @vitest-environment node
import { execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkManifest, detectRuntime, generatedDockerfile } from "@/model/hosting";
import { Secrets } from "../store/secrets";
import { resolveEndpoint } from "./resolve";
import { HostedServices, unsafeMember } from "./services";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-hosting-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const secrets = new Secrets(dir);
const hosted = new HostedServices(dir, "docker", secrets);

/** A .tar.gz of the given files, as base64, built with the system tar. */
function tarOf(files: Record<string, string>, extra: string[] = []): string {
  const src = fs.mkdtempSync(path.join(dir, "src-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fs.writeFileSync(path.join(src, name), text);
  }
  const out = path.join(dir, `a-${Date.now()}-${Math.random()}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", src, ...extra, ...Object.keys(files)]);
  return fs.readFileSync(out).toString("base64");
}

describe("hosted services", () => {
  it("checks a manifest and says what is wrong", () => {
    expect(checkManifest({ expose: { kind: "mcp-stdio" }, start: "python server.py" })).toEqual([]);
    expect(checkManifest({ expose: { kind: "http" }, start: "x" }).join()).toMatch(/needs expose.port/);
    expect(checkManifest({ expose: { kind: "mcp-stdio" }, egress: ["evil host"], env: { "1BAD": "x" } }).length).toBe(2);
  });

  it("tells the runtime from the files, and writes a Dockerfile that installs and runs as a plain user", () => {
    expect(detectRuntime(["Dockerfile", "app.py"])).toBe("dockerfile");
    expect(detectRuntime(["requirements.txt", "server.py"])).toBe("python");
    expect(detectRuntime(["package.json", "index.js"])).toBe("node");
    expect(detectRuntime(["README.md"])).toBeNull();
    const df = generatedDockerfile("python", ["requirements.txt"], { expose: { kind: "mcp-stdio" }, start: "python server.py" });
    expect(df).toMatch(/FROM python:3.12-slim/);
    expect(df).toMatch(/pip install --no-cache-dir -r requirements.txt/);
    expect(df).toMatch(/USER 10001/);
    expect(df).toMatch(/CMD \["sh", "-c", "python server.py"\]/);
  });

  it("refuses archive members that could land outside the project", () => {
    expect(unsafeMember("../etc/passwd")).toBe(true);
    expect(unsafeMember("/etc/passwd")).toBe(true);
    expect(unsafeMember("a/../../b")).toBe(true);
    expect(unsafeMember("src/server.py")).toBe(false);
  });

  it("unpacks an uploaded project, reads its mas-host.yaml, and keeps settings across versions", async () => {
    const s = await hosted.create({
      name: "Notes MCP",
      filename: "notes.tar.gz",
      archive_base64: tarOf({ "notes/server.py": "print('hi')", "notes/mas-host.yaml": "start: python server.py\nexpose: { kind: mcp-stdio }\n" }),
    });
    expect(s.id).toMatch(/^svc_notes_mcp_[0-9a-f]{6}$/);
    expect(s.versions).toHaveLength(1);
    // the archive's single top folder is the project
    expect(fs.existsSync(path.join(hosted.srcDir(s.id, 1), "server.py"))).toBe(true);
    expect(s.manifest).toMatchObject({ start: "python server.py", expose: { kind: "mcp-stdio" } });
    hosted.configure(s.id, { egress: ["api.github.com"] });
    const v2 = await hosted.update(s.id, { filename: "notes.tar.gz", archive_base64: tarOf({ "server.py": "print('v2')", "mas-host.yaml": "start: python server.py\nexpose: { kind: mcp-stdio }\n" }) });
    expect(v2.current).toBe(2);
    expect(v2.manifest.egress).toEqual(["api.github.com"]);
    expect(hosted.list().map((x) => x.id)).toContain(s.id);
    hosted.delete(s.id);
    expect(hosted.get(s.id)).toBeNull();
  });

  it("rejects an archive with a path outside its folder, or with a link", async () => {
    const evil = fs.mkdtempSync(path.join(dir, "evil-"));
    fs.mkdirSync(path.join(evil, "x"));
    fs.writeFileSync(path.join(evil, "x", "ok.txt"), "ok");
    const out = path.join(dir, "evil.tar.gz");
    execFileSync("tar", ["-czf", out, "-C", path.join(evil, "x"), "--transform", "s,^,../,", "ok.txt"]);
    await expect(hosted.create({ name: "evil", filename: "evil.tar.gz", archive_base64: fs.readFileSync(out).toString("base64") })).rejects.toThrow(/outside its folder/);
    fs.symlinkSync("/etc/passwd", path.join(evil, "x", "link"));
    execFileSync("tar", ["-czf", out, "-C", path.join(evil, "x"), "ok.txt", "link"]);
    await expect(hosted.create({ name: "linked", filename: "linked.tar.gz", archive_base64: fs.readFileSync(out).toString("base64") })).rejects.toThrow(/links/);
    expect(hosted.list().filter((x) => /evil|linked/.test(x.name))).toEqual([]);
  });

  it("resolves a remote endpoint with its bearer secret, and says which secret is missing", async () => {
    secrets.set("CRM_TOKEN", "t0ken");
    await expect(resolveEndpoint({ secrets }, { remote: { url: "https://crm.example/mcp", bearer_env: "CRM_TOKEN", headers: { "x-team": "a" } } })).resolves.toEqual({
      url: "https://crm.example/mcp",
      headers: { "x-team": "a", authorization: "Bearer t0ken" },
    });
    await expect(resolveEndpoint({ secrets }, { remote: { url: "https://x", bearer_env: "NOPE" } })).rejects.toThrow(/NOPE/);
    await expect(resolveEndpoint({ secrets }, { hosted: { service: "svc_x_000000" } })).rejects.toThrow(/not available/);
  });
});

describe("egress proxy", () => {
  it("matches declared hosts exactly, by subdomain wildcard, and by port", async () => {
    const { allowed } = await import("./egress");
    expect(allowed(["api.github.com"], "api.github.com", 443)).toBe(true);
    expect(allowed(["api.github.com"], "evil.com", 443)).toBe(false);
    expect(allowed(["api.github.com"], "api.github.com", 22)).toBe(false);
    expect(allowed(["*.example.com"], "a.b.example.com", 443)).toBe(true);
    expect(allowed(["*.example.com"], "example.com", 443)).toBe(false);
    expect(allowed(["*.example.com"], "notexample.com", 443)).toBe(false);
    expect(allowed(["db.example.com:5432"], "db.example.com", 5432)).toBe(true);
  });

  it("asks for credentials, refuses undeclared hosts and private addresses, and keeps each service to its own list", async () => {
    const { EgressProxy } = await import("./egress");
    const p = new EgressProxy();
    const { host, port } = await p.listen("127.0.0.1");
    const a = p.grant("svc_a_000000", ["localhost", "example.com"]);
    p.grant("svc_b_000000", ["other.example"]);
    const connect = (auth: string | null, target: string) =>
      new Promise<string>((resolve) => {
        const s = net.connect(port, host, () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: Basic ${Buffer.from(auth).toString("base64")}\r\n` : ""}\r\n`));
        s.once("data", (d) => (resolve(d.toString().split("\r\n")[0]), s.destroy()));
      });
    try {
      expect(await connect(null, "example.com:443")).toMatch(/407/);
      expect(await connect(`svc_a_000000:${a.token}`, "evil.com:443")).toMatch(/403/);
      // declared, but it resolves to this machine: never through the proxy
      expect(await connect(`svc_a_000000:${a.token}`, "localhost:443")).toMatch(/403/);
      // another service's credentials do not open this service's hosts, and a wrong name does not use them
      expect(await connect(`svc_b_000000:${a.token}`, "example.com:443")).toMatch(/407/);
      expect(p.refused.map((r) => r.why)).toEqual(["not declared", "localhost resolves to a private address"]);
    } finally {
      p.close();
    }
  });
});
