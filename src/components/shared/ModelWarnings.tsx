// Says, before anything is started, which of the models it will use are known
// not to work here: a key that is missing, or one that was refused on its last call.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Api, type ModelHealth } from "@/api/client";
import { modelUses } from "@/model/modelUse";
import type { SystemDoc } from "@/model/types";

/** The catalog models a system actually names, as they will be served. */
export function usedSpecs(doc: SystemDoc) {
  const used = new Set(modelUses(doc).map((u) => u.model));
  return doc.models.filter((m) => used.has(m.id) && m.provider !== "mock");
}

export function ModelWarnings({ doc, skip = false, hint = "" }: { doc: SystemDoc; skip?: boolean; hint?: string }) {
  const specs = useMemo(() => usedSpecs(doc), [doc]);
  const sig = JSON.stringify(specs.map((m) => [m.id, m.provider, m.model, m.api]));
  const [bad, setBad] = useState<ModelHealth[]>([]);
  useEffect(() => {
    if (skip || !specs.length) return setBad([]);
    let live = true;
    Api.modelHealth(specs)
      .then((r) => live && setBad(r.models.filter((m) => m.status === "failing" || m.status === "no_key")))
      .catch(() => live && setBad([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, skip]);
  if (!bad.length) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        {bad.map((m) => (
          <p key={m.id} className="break-words">
            <span className="font-medium">{m.id}</span> ({m.model}) {m.status === "no_key" ? m.why : `failed its last call: ${m.why}`}
          </p>
        ))}
        <p>
          Runs that use {bad.length > 1 ? "them" : "it"} will fail. Check <Link to="/settings" className="underline">Settings → API keys</Link>
          {hint ? `, ${hint}` : ""}.
        </p>
      </div>
    </div>
  );
}
