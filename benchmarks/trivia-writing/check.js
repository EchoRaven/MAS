// Grader check for trivia-writing-20.jsonl: every question's answer (any of its aliases) appears in the story, as
// whole words, case ignored. A system that discusses before writing (Solo Performance Prompting's personas list the
// answers as they talk) is graded on its story alone: the text after its last "Final answer:", else the whole output.
// "why" says how many of the five it found, for the fraction the paper reports.
const want = JSON.parse(expected);
const marks = [...output.matchAll(/final answer\s*:/gi)];
const story = marks.length ? output.slice(marks[marks.length - 1].index + marks[marks.length - 1][0].length) : output;
const text = " " + story.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
const found = want.filter((aliases) => aliases.some((a) => text.includes(" " + a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ")));
return { pass: found.length === want.length, why: found.length + " of " + want.length + " answers" };
