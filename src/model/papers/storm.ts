// STORM: a Wikipedia-style article researched by interviews. A curator picks
// the perspectives the topic needs; for each one an interviewer (spawned)
// questions a topic expert who answers from web search; the interviews become
// an outline, and the outline becomes the article, with its sources.
import { Builder, native, type TemplateInfo } from "../builder";
import { autoLayout } from "../layout";
import type { SystemDoc } from "../types";

const CURATOR = `You research a topic for a Wikipedia-style article by interviews.
1. Pick 3 different perspectives from which an editor would ask about the topic (for example a historian, a practitioner, a critic), each with what it cares about.
2. Call spawn_subagents once with one task per perspective. Each task starts "You are an editor who <perspective and focus>. The topic is <topic>." and asks for an interview.
3. Reply with the interview notes themselves, grouped by perspective, as the interviewers wrote them: every fact and every source URL. Do not write the article or summarise the notes; an outline writer and an article writer work from what you pass on.`;

const INTERVIEWER = `You interview a topic expert to gather material for an article, from the perspective your task gives you.
Ask the expert one question at a time with ask_expert: up to 4 questions, each building on the last answer and going deeper where your perspective needs it.
Then reply with your notes: the facts you learned, each followed by the full source URL the expert gave for it, copied exactly (not just the site's name).`;

const EXPERT = `You are an expert on the topic you are asked about. Answer each question with facts, found with web_search and fetch where you can, and cite the source URL of each fact. If you cannot search, answer from what you know and say that no source was checked. Keep each answer under 200 words.`;

function build(): SystemDoc {
  const b = new Builder(
    "STORM",
    "Writes a Wikipedia-style article by research. A curator chooses perspectives on the topic; for each, an interviewer questions a topic expert who answers from web search; an outline writer organises what the interviews found, and an article writer writes the article from the outline, citing the sources.",
  );
  const single = (instructions: string) => ({ ...native(), loop: "single_shot" as const, instructions });
  b.node("user", "human", 0, 0, { name: "User", role: "Names a topic", approves: false })
    .agent("curator", 0, 0, {
      name: "Curator",
      role: "Chooses perspectives and runs the interviews",
      model: "opus",
      harness: { ...native(), loop: "react", max_steps: 4, instructions: CURATOR },
      spawn: { template: "interviewer", max_instances: 4 },
    })
    .agent("interviewer", 0, 0, { name: "Interviewer", role: "Questions the expert from one perspective", model: "sonnet", harness: { ...native(), loop: "react", max_steps: 6, instructions: INTERVIEWER } })
    .agent("expert", 0, 0, { name: "Topic expert", role: "Answers from web search, with sources", model: "sonnet", tools: ["web_search", "fetch"], concurrency: "parallel", harness: { ...native(), loop: "react", max_steps: 5, instructions: EXPERT } })
    .agent("outliner", 0, 0, { name: "Outline writer", role: "Turns the interviews into an outline", model: "sonnet", harness: single("Write an outline for a Wikipedia-style article on the topic from these interview notes: sections and subsections, each with the facts it will use and the source URL each fact came from. Leave out what the notes do not support.") })
    .agent("writer", 0, 0, { name: "Article writer", role: "Writes the article from the outline", model: "opus", harness: single("Write the article from the outline: a lead paragraph, then the sections, in a neutral encyclopedic tone. Cite sources inline as [n] and list them at the end as References. Every reference is a URL from the outline; never cite a book, author or page the outline does not give. Do not add facts the outline does not have.") })
    .edge("user", "curator", "message", { label: "Topic" })
    .edge("interviewer", "expert", "call")
    .edge("curator", "outliner", "message", { label: "Interviews" })
    .edge("outliner", "writer", "message", { label: "Outline" })
    .edge("writer", "user", "message", { label: "Article" });
  b.doc.budget = { usd: 3, max_rounds: 60, wallclock_min: 20 };
  return autoLayout(b.doc);
}

export const storm: TemplateInfo = {
  id: "paper-storm",
  name: "STORM",
  summary: "perspective-guided interviews (spawned) · an expert grounded in web search · outline · cited article",
  build,
  paper: { title: "Assisting in Writing Wikipedia-like Articles From Scratch with Large Language Models", authors: "Shao et al.", year: 2024, url: "https://arxiv.org/abs/2402.14207" },
  notes: {
    mapped: [
      "Perspective-guided question asking: the curator picks perspectives and spawns one interviewer per perspective, so the number of conversations follows the topic.",
      "Simulated conversations: each interviewer questions the topic expert through a call edge (ask_expert), one question at a time, each building on the last answer. The expert answers from web search and fetch and cites its sources; it runs calls in parallel, so the interviews do not wait for each other.",
      "Outline generation and article writing are two agents in a row, the second told to use only what the outline (and so the research) supports, citing as it goes.",
    ],
    differs: [
      "The paper finds perspectives by reading the tables of contents of related Wikipedia articles; here the curator chooses them itself.",
      "web_search runs as the provider's own search tool on Anthropic models, and on other models through the Gemini API's Google Search (GEMINI_API_KEY); its sources are the pages Google's results point to, resolved from its short-lived redirect links. Without either, the expert answers from what it knows and says no source was checked.",
      "The paper drafts the outline twice (from the model alone, then refined by the research); here there is one outline, from the research.",
    ],
  },
};
