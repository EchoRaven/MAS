// A small Markdown renderer for model replies: headings, bold, italics,
// inline code, fenced code, lists and paragraphs. It builds React elements
// (never HTML strings), so text from a model cannot inject markup.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let i = key;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={i++} className="rounded bg-secondary px-1 font-mono text-[0.92em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={i++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      blocks.push(<pre key={k++} className="overflow-x-auto rounded-md bg-secondary/80 p-2 font-mono text-[12px] leading-snug">{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={k++} className="font-semibold">{inline(h[2])}</p>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])!;
        items.push({ depth: Math.min(3, Math.floor(m[1].length / 2)), ordered: /\d/.test(m[2]), text: m[3] });
      }
      blocks.push(
        <ul key={k++} className="space-y-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5" style={{ paddingLeft: it.depth * 14 }}>
              <span className="shrink-0 text-muted-foreground">{it.ordered ? `${j + 1}.` : "•"}</span>
              <span>{inline(it.text)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^```|^#{1,6}\s|^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) para.push(lines[i]);
    blocks.push(
      <p key={k++}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-1.5 break-words">{blocks}</div>;
}
