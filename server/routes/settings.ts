// Secrets, model connection tests, and the knowledge folder.
import fs from "node:fs";
import path from "node:path";
import type { ModelSpec } from "@/model/types";
import type { Config } from "../config";
import type { Router } from "../http";
import { Models } from "../runtime/models";
import { textOf, userText } from "../runtime/models/types";
import { HttpError, type Store } from "../store/files";
import { Secrets } from "../store/secrets";

export function settingsRoutes(r: Router, store: Store, secrets: Secrets, config: Config) {
  r.on("GET", "/api/secrets", () => {
    const referenced = new Set<string>();
    for (const d of store.listSystems()) for (const m of d.models) if (m.api?.key_env) referenced.add(m.api.key_env);
    for (const n of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) referenced.add(n);
    const names = new Set([...referenced, ...secrets.list().map((s) => s.name)]);
    return { secrets: [...names].sort().map((name) => ({ name, source: secrets.source(name), referenced: referenced.has(name) })) };
  });
  r.on("PUT", "/api/secrets/:name", async (req) => {
    if (!Secrets.validName(req.params.name)) throw new HttpError(400, "Secret names are UPPER_SNAKE_CASE");
    const b = (await req.body()) as { value?: string };
    if (typeof b.value !== "string" || !b.value) throw new HttpError(400, "Give a value");
    secrets.set(req.params.name, b.value);
    return { ok: true };
  });
  r.on("DELETE", "/api/secrets/:name", (req) => {
    secrets.delete(req.params.name);
    return { ok: true };
  });

  r.on("POST", "/api/models/test", async (req) => {
    const { model } = (await req.body()) as { model: ModelSpec };
    if (!model?.id || !model.provider) throw new HttpError(400, "Give a model");
    const models = new Models([model], secrets);
    const t0 = Date.now();
    try {
      if ((model.kind ?? "chat") === "embedding") {
        const [v] = await models.embed(model.id, ["hello"]);
        return { ok: true, ms: Date.now() - t0, reply: `${v.length}-dimensional vector` };
      }
      if (model.kind === "rerank") {
        const s = await models.rerank(model.id, "capital of France", ["Paris is the capital of France.", "Bananas are yellow."]);
        return { ok: true, ms: Date.now() - t0, reply: `scores ${s.map((x) => x.toFixed(2)).join(", ")}` };
      }
      const { res, usage } = await models.chat(model.id, { messages: [userText("Reply with the single word OK.")], max_tokens: 1000 });
      return { ok: true, ms: Date.now() - t0, reply: textOf(res.content).slice(0, 200), usage };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
    }
  });

  // knowledge folder: what knowledge plugins index (sources are paths in here)
  const root = () => {
    const dir = path.resolve(process.env.MAS_KNOWLEDGE_DIR ?? path.join(config.dataDir, "knowledge"));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const inside = (rel: string) => {
    const base = root();
    const f = path.resolve(base, rel.replace(/^\/+/, ""));
    if (f !== base && !f.startsWith(base + path.sep)) throw new HttpError(400, "Path escapes the knowledge folder");
    return f;
  };
  r.on("GET", "/api/knowledge", () => {
    const base = root();
    const out: { path: string; size: number }[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (out.length < 2000) out.push({ path: path.relative(base, f), size: fs.statSync(f).size });
      }
    };
    walk(base);
    return { root: base, files: out };
  });
  r.on("PUT", "/api/knowledge/:path*", async (req) => {
    const f = inside(req.params.path);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, await req.text());
    return { ok: true };
  });
  r.on("DELETE", "/api/knowledge/:path*", (req) => {
    fs.rmSync(inside(req.params.path), { force: true });
    return { ok: true };
  });
}
