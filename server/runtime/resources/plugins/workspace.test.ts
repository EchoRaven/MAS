// @vitest-environment node
// Workspace paths stay inside the workspace: no "..", no absolute paths, and
// no symbolic links out of it (a sandbox sharing the folder can create them).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WorkspacePlugin, confine } from "./workspace";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "mas-ws-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("confine", () => {
  const root = path.join(base, "data", "state", "sys", "fs", "work");
  fs.mkdirSync(root, { recursive: true });
  // a secret next to the data folder, the way .data/secrets.json sits above the workspaces
  fs.writeFileSync(path.join(base, "data", "secrets.json"), '{"KEY":"s3cret"}');
  fs.writeFileSync(path.join(root, "ok.txt"), "fine");

  it("allows files inside, and refuses .. and absolute paths that leave", () => {
    expect(confine(root, "ok.txt")).toBe(fs.realpathSync(path.join(root, "ok.txt")));
    expect(confine(root, "sub/new.txt")).toBe(path.join(fs.realpathSync(root), "sub", "new.txt"));
    expect(() => confine(root, "../../../secrets.json")).toThrow(/escapes the workspace/);
    // a leading slash means the workspace's own root, not the server's
    expect(confine(root, "/ok.txt")).toBe(fs.realpathSync(path.join(root, "ok.txt")));
  });

  it("refuses a symbolic link that points out of the workspace, as a sandbox could plant one", () => {
    fs.symlinkSync("../../../../secrets.json", path.join(root, "key"));
    expect(fs.readFileSync(path.join(root, "key"), "utf8")).toContain("s3cret"); // the link really does reach it
    expect(() => confine(root, "key")).toThrow(/escapes the workspace/);
    // a directory link out, then a file under it
    fs.symlinkSync("../../../..", path.join(root, "up"));
    expect(() => confine(root, "up/secrets.json")).toThrow(/escapes the workspace/);
    // a dangling link out: writing through it would create a file outside
    fs.symlinkSync("../../../../planted.txt", path.join(root, "dangling"));
    expect(() => confine(root, "dangling")).toThrow(/escapes the workspace/);
  });

  it("allows a link that stays inside", () => {
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "a.md"), "a");
    fs.symlinkSync("docs/a.md", path.join(root, "alias.md"));
    expect(confine(root, "alias.md")).toBe(fs.realpathSync(path.join(root, "docs", "a.md")));
  });
});

describe("a workspace's scope", () => {
  const rcFor = (scope: string, runId: string) => {
    const node = { id: "pad", data: { kind: "plugin", preset: "workspace", name: "Pad", spec: { scope, sources: ["/pad"], tools: [{ name: "list_files" }, { name: "read_file" }, { name: "write_file" }] } } };
    const store = { stateDir: (...p: string[]) => { const d = path.join(base, "scoped", scope, ...p); fs.mkdirSync(d, { recursive: true }); return d; } };
    return { rc: { doc: { id: "sys", nodes: [node] }, byId: new Map([["pad", node]]), store, runId, vars: {} }, node };
  };
  const files = async (scope: string, runId: string) => {
    const { rc, node } = rcFor(scope, runId);
    const ws = new WorkspacePlugin(rc as never, node as never);
    const tools = await ws.tools({ data: { access: "read_write" } } as never);
    const call = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args, { node: "writer" } as never);
    return { call };
  };

  it("run: each run starts empty, so one story's notes never reach another's", async () => {
    const one = await files("run", "r1");
    await one.call("write_file", { path: "notes/plot.md", content: "a lighthouse" });
    const two = await files("run", "r2");
    expect(await two.call("list_files", {})).toBe("(empty)");
    expect(await one.call("read_file", { path: "notes/plot.md" })).toBe("a lighthouse");
  });

  it("system: every run shares the files, and they are kept", async () => {
    const one = await files("system", "r1");
    await one.call("write_file", { path: "kept.md", content: "x" });
    const two = await files("system", "r2");
    expect(await two.call("read_file", { path: "kept.md" })).toBe("x");
  });
});
