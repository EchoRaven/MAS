// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Secrets } from "../../store/secrets";
import { Models, noteHealth, rateLimit, resetHealth, setRateWindow } from ".";

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

describe("rate limit", () => {
  it("holds calls over the per-minute limit until there is room; local servers and cancelled calls are not held", async () => {
    setRateWindow(200);
    try {
      const google = { id: "g", provider: "google" as const, model: "m", api: { key_env: "K", params: { rpm: 2 } }, price_in: 0, price_out: 0, modalities: ["text"] };
      const t0 = Date.now();
      await rateLimit(google, "key-a");
      await rateLimit(google, "key-a");
      expect(Date.now() - t0).toBeLessThan(50);
      await rateLimit(google, "key-a"); // the third waits for the window
      expect(Date.now() - t0).toBeGreaterThanOrEqual(180);
      // another key has its own allowance
      const t1 = Date.now();
      await rateLimit(google, "key-b");
      expect(Date.now() - t1).toBeLessThan(50);
      // a model server on this machine is not limited unless it says so
      const local = { id: "l", provider: "openai_compatible" as const, model: "m", api: { base_url: "http://127.0.0.1:8000/v1" }, price_in: 0, price_out: 0, modalities: ["text"] };
      const t2 = Date.now();
      for (let i = 0; i < 100; i++) await rateLimit(local, undefined);
      expect(Date.now() - t2).toBeLessThan(50);
      // a cancelled run stops waiting
      await rateLimit(google, "key-c");
      await rateLimit(google, "key-c");
      const ctrl = new AbortController();
      const waiting = rateLimit(google, "key-c", ctrl.signal);
      ctrl.abort(new Error("stopped"));
      await expect(waiting).rejects.toThrow("stopped");
    } finally {
      setRateWindow(60_000);
    }
  });
});
