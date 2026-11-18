// API keys and other secrets. Systems only ever name an env var (e.g.
// ModelSpec.api.key_env = "ANTHROPIC_API_KEY"); the value comes from this
// store, or from the server's own environment. Values are never sent back to
// the browser — only which names are set.
import fs from "node:fs";
import path from "node:path";

const NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;

export class Secrets {
  private file: string;
  private values: Record<string, string>;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, "secrets.json");
    try {
      this.values = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.values = {};
    }
  }

  static validName(name: string) {
    return NAME.test(name);
  }

  get(name: string | undefined | null): string | undefined {
    if (!name) return undefined;
    return this.values[name] ?? process.env[name] ?? undefined;
  }

  /** Every known name and where its value comes from. */
  list(): { name: string; source: "store" | "environment" }[] {
    return Object.keys(this.values)
      .sort()
      .map((name) => ({ name, source: "store" as const }));
  }

  /**
   * Secret values to keep out of run logs: every stored one, plus the given
   * names from the environment. Short values are left out (too likely to
   * match ordinary text).
   */
  valuesToHide(names: string[] = []): [string, string][] {
    const out = new Map<string, string>();
    for (const [n, v] of Object.entries(this.values)) if (v && v.length >= 8) out.set(n, v);
    for (const n of names) {
      const v = process.env[n];
      if (v && v.length >= 8 && !out.has(n)) out.set(n, v);
    }
    return [...out.entries()];
  }

  has(name: string) {
    return this.get(name) !== undefined;
  }

  source(name: string): "store" | "environment" | null {
    if (name in this.values) return "store";
    if (process.env[name] !== undefined) return "environment";
    return null;
  }

  set(name: string, value: string) {
    if (!NAME.test(name)) throw new Error(`Secret names are UPPER_SNAKE_CASE: ${name}`);
    this.values[name] = value;
    this.save();
  }

  delete(name: string) {
    delete this.values[name];
    this.save();
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
