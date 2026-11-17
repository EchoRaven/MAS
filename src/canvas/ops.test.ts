import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/model/templates";
import { validate } from "@/model/validate";
import { reconnect, setEdgePoints } from "./ops";

const coding = () => TEMPLATES.find((t) => t.id === "coding")!.build();

describe("edge edits", () => {
  it("reconnect moves one end and keeps the edge's settings", () => {
    const doc = coding();
    const e = doc.edges.find((x) => x.source === "reviewer" && x.target === "pm")!; // call with a transform
    const r = reconnect(doc, undefined, e.id, { source: "reviewer", sourceHandle: "approve", target: "planner", targetHandle: "in" });
    expect(r.error).toBeUndefined();
    const moved = r.doc.edges.find((x) => x.id === e.id)!;
    expect(moved).toMatchObject({ source: "reviewer", target: "planner", target_port: "in", kind: "call", label: e.label });
    expect(moved.transform).toEqual(e.transform);
    expect(validate(r.doc).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reconnect refuses a duplicate and leaves the doc alone", () => {
    const doc = coding();
    const e = doc.edges.find((x) => x.source === "reviewer" && x.target === "pm")!;
    const dup = doc.edges.find((x) => x.source === "coder" && x.target === "reviewer")!;
    const r = reconnect(doc, undefined, e.id, { source: dup.source, sourceHandle: dup.source_port, target: dup.target, targetHandle: dup.target_port });
    expect(r.error).toBeTruthy();
    expect(r.doc).toBe(doc);
  });

  it("waypoints are saved, rounded, and cleared", () => {
    const doc = coding();
    const id = doc.edges[0].id;
    const routed = setEdgePoints(doc, id, [{ x: 10.4, y: 20.6 }, { x: 50, y: 60 }]);
    expect(routed.edges[0].points).toEqual([{ x: 10, y: 21 }, { x: 50, y: 60 }]);
    expect("points" in setEdgePoints(routed, id, []).edges[0]).toBe(false);
  });
});
