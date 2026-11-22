// Grader check for game24-50.jsonl: the final answer is an expression that uses exactly the four numbers (the
// expected field) once each, with + - * / and parentheses, and equals 24. "= 24" after it (or "24 =" before it),
// Markdown bold, LaTeX and the signs × ÷ · are tolerated.
const nums = (expected.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
let s = answer.replace(/\*\*/g, "").replace(/\$/g, "").replace(/\\times|\\cdot|[×·]/g, "*").replace(/\\div|÷/g, "/").replace(/\\left|\\right/g, "").replace(/[{}]/g, "").replace(/[−–]/g, "-");
const sides = s.split("=").map((x) => x.trim()).filter((x) => x && !/^24(\.0+)?$/.test(x));
const expr = (sides[0] || "").replace(/\.$/, "");
if (!/^[\d+\-*/().\s]+$/.test(expr)) return { pass: false, why: "not an arithmetic expression: " + expr.slice(0, 80) };
const used = (expr.match(/\d+/g) || []).map(Number).sort((a, b) => a - b);
if (used.join(",") !== nums.join(",")) return { pass: false, why: "uses " + used.join(", ") + ", not " + nums.join(", ") };
let v;
try { v = Function("return (" + expr + ")")(); } catch (e) { return { pass: false, why: "does not parse: " + expr }; }
return { pass: Math.abs(v - 24) < 1e-9, why: expr + " = " + v };
