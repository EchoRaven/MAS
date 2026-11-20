// Diverse Multi-Agent Debate (DMAD, "Breaking Mental Set"): debaters who
// reason the same way share the same blind spots, so each debater here is
// given a different reasoning method; the rounds and the vote are Multiagent
// Debate's. Built with the debate's own builder (debateWith), so the two
// differ only in the debaters' instructions.
import type { TemplateInfo } from "../builder";
import type { SystemDoc } from "../types";
import { debateWith, METHODS } from "./debate";

function build(): SystemDoc {
  const doc = debateWith(3, "full", true);
  doc.name = "Diverse Multi-Agent Debate";
  doc.description = `Three debaters, each reasoning a different way (${METHODS.slice(0, 3).map((m) => m.name).join(", ")}), answer, read each other's answers and revise for two rounds (the run variable rounds); a majority vote gives the answer. Multiagent Debate with diverse methods instead of three copies of one.`;
  return doc;
}

export const dmad: TemplateInfo = {
  id: "paper-dmad",
  name: "Diverse Multi-Agent Debate",
  summary: "three debaters, three reasoning methods · rounds of revision · majority vote",
  build,
  paper: { title: "Breaking Mental Set to Improve Reasoning through Diverse Multi-Agent Debate", authors: "Liu et al.", year: 2025, url: "https://proceedings.iclr.cc/paper_files/paper/2025/hash/3de667dab3b3d812583abc0a786139a0-Abstract-Conference.html" },
  notes: {
    mapped: [
      "Each debater's instructions add one reasoning method: step by step, decompose into sub-problems, or work out the answer and check it another way (estimate, a property it must have, another route).",
      "The rounds (2, the run variable rounds) and the majority vote are Multiagent Debate's: the same builder, debateWith(3, \"full\", true), so the comparison with plain debate isolates the methods.",
    ],
    differs: [
      "The paper's agents use established prompting methods as their different ways of reasoning; here three methods written for this platform, on one model.",
      "debateWith(3, \"full\", 0) is the control the paper's argument needs: three debaters all on one method, to separate the methods' own effect from their diversity.",
    ],
  },
};
