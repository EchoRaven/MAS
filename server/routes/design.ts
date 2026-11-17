// The architect endpoint: describe a system, get one back.
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODELS } from "@/model/defaults";
import type { Config } from "../config";
import { design } from "../design/architect";
import type { Router } from "../http";
import { Models } from "../runtime/models";
import { HttpError, type Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import { checkDoc } from "./systems";

/** The knowledge folder's top two levels: folders end with /. */
function knowledgeContents(config: Config): string[] {
  const root = path.resolve(process.env.MAS_KNOWLEDGE_DIR ?? path.join(config.dataDir, "knowledge"));
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (!e.isDirectory()) out.push(e.name);
    else {
      out.push(e.name + "/");
      for (const f of fs.readdirSync(path.join(root, e.name)).slice(0, 20)) if (!f.startsWith(".")) out.push(`${e.name}/${f}`);
    }
  }
  return out.slice(0, 80);
}

export function designRoutes(r: Router, store: Store, secrets: Secrets, config: Config) {
  r.on("POST", "/api/design", async (req) => {
    const b = (await req.body()) as { prompt?: string; doc?: unknown; system_id?: string; model?: string; mock?: boolean };
    const prompt = String(b.prompt ?? "").trim();
    if (!prompt) throw new HttpError(400, "Say what the system should do");
    const doc = b.doc ? checkDoc(b.doc) : b.system_id ? (store.getSystem(b.system_id) ?? undefined) : undefined;
    const models = new Models(doc?.models ?? DEFAULT_MODELS, secrets, !!b.mock);
    // learn which models answer before designing with them
    if (!b.mock) await models.probe();
    // the architect itself runs on the best model that answered
    const model = b.model ?? models.usable("chat")[0]?.id ?? null;
    const result = await design({ models, model, prompt, doc, signal: AbortSignal.timeout(10 * 60_000), knowledge: knowledgeContents(config) });
    return result;
  });
}
