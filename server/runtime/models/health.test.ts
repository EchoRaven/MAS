// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Secrets } from "../../store/secrets";
import { Models, noteHealth, resetHealth } from ".";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mas-health-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("model health", () => {
  const spec = { id: "g", provider: "google" as const, model: "gemini-x", api: { key_env: "HEALTH_TEST_KEY" }, price_in: 0, price_out: 0, modalities: ["text"] };

  it("a refused key marks the model failing; a new key under the same name starts clean", () => {
    resetHealth();
    const secrets = new Secrets(dir);
    const m = new Models([spec], secrets);
    expect(m.report()[0].status).toBe("no_key");
    secrets.set("HEALTH_TEST_KEY", "old-key");
    expect(m.report()[0].status).toBe("unknown");
    noteHealth(spec, false, new Error("google 401: The bound service account is deleted or disabled."), "old-key");
    expect(m.report()[0]).toMatchObject({ status: "failing", why: expect.stringMatching(/401/) });
    expect(m.usable()).toEqual([]);
    secrets.set("HEALTH_TEST_KEY", "new-key");
    expect(m.report()[0].status).toBe("unknown");
    expect(m.usable().map((x) => x.id)).toEqual(["g"]);
    resetHealth();
  });
});
