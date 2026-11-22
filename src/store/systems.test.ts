import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_COALESCE_MS, useSystems } from "./systems";

const rename = (id: string, name: string) => useSystems.getState().update(id, (d) => ({ ...d, name }));
const nameOf = (id: string) => useSystems.getState().get(id)!.name;

describe("undo and redo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("undoes edits one step at a time, joins a quick burst into one, and redoes", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const s = useSystems.getState();
    const doc = s.create("blank");
    const id = doc.id;
    const first = nameOf(id);
    expect(s.canUndo(id)).toBe(false);

    rename(id, "A");
    now += 100;
    rename(id, "AB"); // within the burst: one step with "A"
    now += HISTORY_COALESCE_MS + 1;
    rename(id, "ABC"); // a new step

    expect(nameOf(id)).toBe("ABC");
    useSystems.getState().undo(id);
    expect(nameOf(id)).toBe("AB");
    useSystems.getState().undo(id);
    expect(nameOf(id)).toBe(first); // the burst undone as one step
    expect(useSystems.getState().canUndo(id)).toBe(false);

    useSystems.getState().redo(id);
    expect(nameOf(id)).toBe("AB");
    expect(useSystems.getState().canRedo(id)).toBe(true);

    // an edit after undoing drops what could be redone
    now += HISTORY_COALESCE_MS + 1;
    rename(id, "X");
    expect(useSystems.getState().canRedo(id)).toBe(false);
    useSystems.getState().undo(id);
    expect(nameOf(id)).toBe("AB");
  });
});
