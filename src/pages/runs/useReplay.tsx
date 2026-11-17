// Playback of an event stream (a simulation or a recorded run): play, pause,
// step, restart, speed. Long real-time gaps (waiting on a rate limit, a slow
// model) are compressed so the replay keeps moving.
import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { RunEvent } from "@/run/events";

export function useReplay(events: RunEvent[], autoplay = true) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState("2");
  const total = events.length;

  useEffect(() => {
    setIdx(0);
    setPlaying(autoplay);
  }, [events, autoplay]);

  useEffect(() => {
    if (!playing || idx >= total) return;
    const cur = events[idx - 1]?.t ?? 0;
    const next = events[idx]?.t ?? cur;
    const ms = Math.min(1500, Math.max(60, ((next - cur) * 1000) / Number(speed)));
    const h = setTimeout(() => setIdx((i) => i + 1), ms);
    return () => clearTimeout(h);
  }, [playing, idx, total, speed, events]);

  const done = idx >= total;
  const controls = (
    <>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPlaying(!playing)} disabled={done} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setIdx((i) => Math.min(total, i + 1))} disabled={done} aria-label="Next event">
        <SkipForward className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setPlaying(true); }} aria-label="Restart">
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Select value={speed} onValueChange={setSpeed} size="sm" ariaLabel="Speed" items={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "5", label: "5×" }, { value: "20", label: "20×" }]} />
      <Button variant="ghost" size="sm" className="h-8" onClick={() => { setIdx(total); setPlaying(false); }} disabled={done}>
        Skip to end
      </Button>
    </>
  );
  return { idx, playing, done, total, controls };
}
