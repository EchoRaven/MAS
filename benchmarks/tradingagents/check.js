// Grader check for the backtest's cases: a decision passes when its direction was right, BUY before a rise or SELL
// before a fall (the day's next return is in expected). HOLD calls no direction and fails, so accuracy is right calls
// of all decisions; "why" names the action and the move, so right of BUY/SELL calls can be counted from the reasons.
const want = JSON.parse(expected);
const m = [...output.matchAll(/(?:final answer|answer|final|decision)\W*\s*(buy|sell|hold)\b/gi)];
const any = [...output.matchAll(/\b(buy|sell|hold)\b/gi)];
const a = (m.length ? m[m.length - 1][1] : any.length ? any[any.length - 1][1] : "").toUpperCase();
const r = want.next_return;
const move = (r > 0 ? "rose " : r < 0 ? "fell " : "unchanged ") + (Math.round(r * 10000) / 100) + "%";
if (!a) return { pass: false, why: "no action · " + move };
const pass = (a === "BUY" && r > 0) || (a === "SELL" && r < 0);
return { pass, why: a + " · " + move };
