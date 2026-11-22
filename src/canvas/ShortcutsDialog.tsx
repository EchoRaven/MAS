// The canvas's keyboard shortcuts, opened with "?" (or the keyboard button in the toolbar).
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT } from "./Palette";

const KIND_NAME: Record<keyof typeof SHORTCUT, string> = { agent: "an agent", model: "a model call", function: "a function", human: "a person", env: "an environment", plugin: "a plugin", group: "a group" };

const ROWS: [string, string][] = [
  ["Ctrl/Cmd+Z", "Undo (a drag counts as one step)"],
  ["Ctrl/Cmd+Shift+Z, Ctrl+Y", "Redo"],
  ["Ctrl/Cmd+C", "Copy the selected components (a group with its members)"],
  ["Ctrl/Cmd+V", "Paste, here or in another system"],
  ["Ctrl/Cmd+D", "Duplicate the selection"],
  ["Delete, Backspace", "Delete the selection"],
  ["Shift+drag", "Select several components"],
  ["Double-click", "Open a group's canvas, or an agent's internals"],
  ["?", "These shortcuts"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const adds = (Object.keys(SHORTCUT) as (keyof typeof SHORTCUT)[]).map((k) => [SHORTCUT[k], `Add ${KIND_NAME[k]}`] as [string, string]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>On the canvas, when you are not typing in a field.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <tbody>
            {[...ROWS, ...adds].map(([keys, what]) => (
              <tr key={keys} className="border-t border-border/50">
                <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{keys}</td>
                <td className="py-1.5 text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
