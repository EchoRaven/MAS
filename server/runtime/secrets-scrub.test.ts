// @vitest-environment node
// Secret values never reach a run's log, even when something in the run prints them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Builder } from "@/model/builder";
import { port } from "@/model/ports";
import type { RunEvent } from "@/run/events";
import type { Config } from "../config";
import { Store } from "../store/files";
import { Secrets } from "../store/secrets";
import { RunManager } from "./runs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-scrub-"));
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SCRUB_TEST_MODEL_KEY;
});

describe("secret values in runs", () => {
  it("are replaced by their names in every stored event", async () => {
    const secrets = new Secrets(dir);
    secrets.set("STORED_TOKEN", "tok_live_8f3k2j5h7g9d");
    process.env.SCRUB_TEST_MODEL_KEY = "AIzaFAKEenvKEY000111222333444555666";
    const config: Config = { host: "127.0.0.1", port: 0, dataDir: dir, token: "t", allowLocalExec: false, docker: "/x", parallelism: 2 };
    const store = new Store(dir);
    const runs = new RunManager(store, secrets, config);

    // a function that "leaks" both values, the way a tool echoing its environment or an error quoting a key would
    const b = new Builder("Leaky", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .node("leak", "function", 0, 0, { name: "Leak", fn: { lang: "js", code: 'return "stored tok_live_8f3k2j5h7g9d and env AIzaFAKEenvKEY000111222333444555666";' }, interface: { inputs: [port("in", "text")], outputs: [port("out", "text")] } })
      .edge("me", "leak", "message")
      .edge("leak", "me", "message");
    b.doc.models.push({ id: "uses_env", provider: "google", model: "x", api: { key_env: "SCRUB_TEST_MODEL_KEY" }, price_in: 0, price_out: 0, modalities: ["text"] });
    const rec = runs.start(b.doc, { input: "go" });
    for (let i = 0; i < 300 && runs.isActive(rec.id); i++) await new Promise((r) => setTimeout(r, 10));

    const stored = JSON.stringify(store.events(rec.id) as RunEvent[]);
    expect(stored).not.toContain("tok_live_8f3k2j5h7g9d");
    expect(stored).not.toContain("AIzaFAKEenvKEY000111222333444555666");
    const out = (store.events(rec.id) as RunEvent[]).find((e) => e.type === "output") as { text: string };
    expect(out.text).toBe("stored [secret STORED_TOKEN] and env [secret SCRUB_TEST_MODEL_KEY]");
  });
});
