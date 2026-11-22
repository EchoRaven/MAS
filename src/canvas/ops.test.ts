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

describe("copy and paste", () => {
  it("copies a group with its members and the connections among them, and pastes them with new ids", async () => {
    const { copyNodes, pasteNodes } = await import("./ops");
    const { Builder, native } = await import("@/model/builder");
    const b = new Builder("Copy", "");
    b.node("me", "human", 0, 0, { name: "Me", role: "", approves: false })
      .group("team", 100, 0, { name: "Team" })
      .agent("a", 0, 0, { name: "Ann", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } }, "team")
      .agent("b", 200, 0, { name: "Bo", model: "sonnet", harness: { ...native(), loop: "single_shot", instructions: "" } }, "team")
      .edge("a", "b", "message")
      .edge("me", "team", "message"); // to something outside the copy: not copied
    const doc = b.doc;
    const clip = copyNodes(doc, ["team"]);
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "team"]);
    expect(clip.edges.map((e) => [e.source, e.target])).toEqual([["a", "b"]]);

    const { doc: out, ids } = pasteNodes(doc, clip, undefined);
    expect(out.nodes.length).toBe(doc.nodes.length + 3);
    expect(ids.length).toBe(1); // the group is the top level of what was pasted
    const team2 = out.nodes.find((n) => n.id === ids[0])!;
    expect(team2.id).not.toBe("team");
    expect((team2.data as { name: string }).name).toBe("Team (copy)");
    expect(team2.position).toEqual({ x: 140, y: 40 });
    const members = out.nodes.filter((n) => n.parent === team2.id);
    expect(members.map((n) => (n.data as { name: string }).name).sort()).toEqual(["Ann (copy)", "Bo (copy)"]);
    const e2 = out.edges.find((e) => members.some((m) => m.id === e.source) && members.some((m) => m.id === e.target))!;
    expect(e2.id).not.toBe(clip.edges[0].id);
    // the originals are untouched, and the copy's connection joins the copies
    expect(out.edges.filter((e) => e.source === "a" && e.target === "b").length).toBe(1);
  });
});
