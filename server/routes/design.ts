// The architect endpoint: describe a system, get one back.
import { DEFAULT_MODELS } from "@/model/defaults";
import { design } from "../design/architect";
import type { Router } from "../http";
import { Models } from "../runtime/models";
import { HttpError, type Store } from "../store/files";
import type { Secrets } from "../store/secrets";
import { checkDoc } from "./systems";

export function designRoutes(r: Router, store: Store, secrets: Secrets) {
  r.on("POST", "/api/design", async (req) => {
    const b = (await req.body()) as { prompt?: string; doc?: unknown; system_id?: string; model?: string; mock?: boolean };
    const prompt = String(b.prompt ?? "").trim();
    if (!prompt) throw new HttpError(400, "Say what the system should do");
    const doc = b.doc ? checkDoc(b.doc) : b.system_id ? (store.getSystem(b.system_id) ?? undefined) : undefined;
    const models = new Models(doc?.models ?? DEFAULT_MODELS, secrets, !!b.mock);
    const result = await design({ models, model: b.model ?? null, prompt, doc, signal: AbortSignal.timeout(10 * 60_000) });
    return result;
  });
}
