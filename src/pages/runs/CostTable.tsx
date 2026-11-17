import { tokens as fmtTokens, usd } from "@/lib/format";
import type { SimState } from "@/run/simulate";

export function CostTable({ perAgent, nameOf, note }: { perAgent: SimState["perAgent"]; nameOf: (id: string) => { name: string }; note?: string }) {
  return (
    <>
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">Agent</th>
                      <th className="py-1.5 text-right font-medium">Calls</th>
                      <th className="py-1.5 text-right font-medium">Input</th>
                      <th className="py-1.5 text-right font-medium">Output</th>
                      <th className="py-1.5 text-right font-medium">USD</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {Object.entries(perAgent)
                      .sort((a, b) => b[1].usd - a[1].usd)
                      .map(([id, p]) => (
                        <tr key={id} className="border-t border-border/70">
                          <td className="py-1.5">{nameOf(id).name}</td>
                          <td className="py-1.5 text-right">{p.calls}</td>
                          <td className="py-1.5 text-right">{fmtTokens(p.tokens_in)}</td>
                          <td className="py-1.5 text-right">{fmtTokens(p.tokens_out)}</td>
                          <td className="py-1.5 text-right">
                            {usd(p.usd)}
                            {p.estimated && <span className="text-muted-foreground" title="The harness does not report cost; estimated from model prices">*</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-muted-foreground">* This harness does not report cost; the platform estimates it from model prices.{note ? ` ${note}` : ""}</p>
    </>
  );
}
