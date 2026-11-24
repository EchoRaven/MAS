// @vitest-environment node
// One agent's memory writes run one after another: a write reads the file, waits on a model, then saves, and two at
// once used to read the same file, so the later save dropped the other's records.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryPlugin } from "./memory";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "mas-mem-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function plugin() {
  const dir = path.join(base, "state");
  fs.mkdirSync(dir, { recursive: true });
  const rc = { runId: "r1", vars: {}, doc: { id: "sys" }, byId: new Map(), emit: () => {}, store: { stateDir: () => dir } } as never;
  const node = {
    id: "memory",
    data: {
      kind: "plugin",
      name: "Memory",
      spec: {
        scope: "agent",
        memory: {
          extract: { use: "whole_turn", params: {} },
          // a model rating each memory takes a moment: the window in which writes used to overlap
          classify: { use: "custom", fn: { lang: "js", code: "for (let i = 0; i < 50; i++) await Promise.resolve(); return '2';" } },
          merge: { use: "append", params: {} },
          retain: { use: "forever", params: {} },
          consolidate: { use: "none", params: {} },
        },
        tools: [],
      },
    },
  } as never;
  return { p: new MemoryPlugin(rc, node), dir };
}

describe("memory writes", () => {
  it("keeps every record when one agent's writes overlap", async () => {
    const { p, dir } = plugin();
    await Promise.all([p.write("klaus", "heard of a party at the cafe"), p.write("klaus", "walked to the park"), p.write("klaus", "read in the library")]);
    const file = fs.readdirSync(dir).find((f) => f.includes("klaus"))!;
    const recs = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).records as { text: string; meta: { importance: number } }[];
    expect(recs.map((r) => r.text).sort()).toEqual(["heard of a party at the cafe", "read in the library", "walked to the park"]);
    expect(recs.every((r) => r.meta.importance === 2)).toBe(true);
  });
});
