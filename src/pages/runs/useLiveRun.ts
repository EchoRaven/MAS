// A system's runs on the server: history, the selected run's events (live
// while it runs), and the actions on it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Api, followRun } from "@/api/client";
import type { SystemDoc } from "@/model/types";
import type { HumanRequest, RunEvent, RunRecord } from "@/run/events";

export function useLiveRun(doc: SystemDoc) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [system, setSystem] = useState<SystemDoc | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const follow = useRef<AbortController | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const r = await Api.runs(doc.id);
      setRuns(r.runs);
      return r.runs;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, [doc.id]);

  // the list, and the run named in ?run= (an evaluation's case links there), else the latest
  useEffect(() => {
    setSelected(null);
    setEvents([]);
    const wanted = new URLSearchParams(window.location.search).get("run");
    void refreshList().then((rs) => {
      const pick = rs.find((r) => r.id === wanted) ?? rs[0];
      if (pick) setSelected(pick.id);
    });
  }, [refreshList]);

  // load the selected run, then follow it while it is active
  useEffect(() => {
    follow.current?.abort();
    if (!selected) return;
    const ctrl = new AbortController();
    follow.current = ctrl;
    setEvents([]);
    void (async () => {
      try {
        const r = await Api.run(selected);
        if (ctrl.signal.aborted) return;
        setRecord(r.run);
        setSystem(r.system);
        setActive(r.active);
        if (!r.active) {
          setEvents(r.events);
          return;
        }
        const buf: RunEvent[] = [];
        let flush: ReturnType<typeof setTimeout> | undefined;
        await followRun(
          selected,
          (e) => {
            buf.push(e);
            flush ??= setTimeout(() => {
              flush = undefined;
              setEvents([...buf]);
            }, 60);
          },
          ctrl.signal,
        );
        setEvents([...buf]);
        if (!ctrl.signal.aborted) {
          setActive(false);
          const done = await Api.run(selected);
          setRecord(done.run);
          void refreshList();
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, [selected, refreshList]);

  const start = async (input: string, mock: boolean, force = false) => {
    setError("");
    try {
      const rec = await Api.startRun({ doc, input, mock, force });
      setRuns((rs) => [rec, ...rs]);
      setSelected(rec.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // pending requests: asked and not yet answered
  const answered = new Set(events.filter((e) => e.type === "human_response").map((e) => (e as { id: string }).id));
  const pending: HumanRequest[] = active ? events.filter((e): e is Extract<RunEvent, { type: "human_request" }> => e.type === "human_request").map((e) => e.request).filter((r) => !answered.has(r.id)) : [];

  return {
    runs,
    selected,
    select: setSelected,
    events,
    record,
    system,
    active,
    error,
    pending,
    start,
    stop: async () => selected && (await Api.stop(selected).catch((e) => setError(e.message))),
    answer: async (request: string, a: { approved?: boolean; text?: string }) => selected && (await Api.answer(selected, request, a).catch((e) => setError(e.message))),
    remove: async (id: string) => {
      await Api.deleteRun(id).catch((e) => setError(e.message));
      const rs = await refreshList();
      setSelected(rs[0]?.id ?? null);
    },
  };
}
