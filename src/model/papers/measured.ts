// What each paper template scored on this platform, from docs/benchmarks.md: shown with the template, so
// whoever picks one knows how it did here, not only what its paper claims. "Hard computation" is the built-in
// 30-question set; flash-lite is gemini-3.1-flash-lite, where a single agent scores 19.
export const MEASURED: Record<string, string[]> = {
  "paper-debate": [
    "Hard computation (flash-lite): 21, 21 against one agent's 19; on the weaker gemma, 26 against one agent's 27.",
    "With 2, 3, 5 debaters (flash-lite): 20, 21, 22.5; five beat one agent significantly (+8 −1, p 0.04), at 17 times its cost.",
    "Five in a ring, each reading its neighbours (sparse communication): 22, 22, a question below the full exchange; a third less to read, but output dominates the cost.",
    "Three debaters with different methods (step by step, decompose, check another way): 23, 23, +9 −1 against one agent (p 0.02); three all told step by step: 21.5. On MATH level 5: 45, as a vote and a code runner.",
    "MMLU (100): 95.5 against 95.0 on flash-lite, 89 against 90 on gemma: no gain where errors are missing knowledge.",
    "With a sandbox per debater, MATH-500 (50): 49, against one agent with a sandbox's 48, at four times the cost.",
  ],
  "paper-reconcile": ["Hard computation (flash-lite): 22, 22; on gemma 26, against one agent's 27.", "One seat per model (three models): 27.3 over three runs, the same as its strongest seat alone."],
  "paper-agent-forest": ["Hard computation (flash-lite): 22 with three samples, flat beyond; on gemma (five samples) 25, against one agent's 27."],
  "paper-eot": ["Hard computation (flash-lite): 23, the best score there without tools."],
  "paper-dylan": ["Hard computation (flash-lite): 22; a team of two chosen by learned importance: 20, at 24% less."],
  "paper-mad": ["Hard computation (flash-lite): 14, 14, below one agent: the devil argues the judge out of right products."],
  "paper-agentverse": ["Hard computation (flash-lite): 20; its evaluator scores wrong products 10/10."],
  "paper-autoagents": ["Hard computation (flash-lite): 14; its quality-assurance agent confirms wrong products."],
  "paper-moa": ["Hard computation (flash-lite): 17; with three different models proposing, 28, against the best of them alone 26 (one run each, p = 0.5).", "Self-MoA (every slot on that best model): 26, missing exactly what that model misses alone."],
  "paper-medagents": ["Hard computation (flash-lite): 16.", "MMLU medical (75): 73 against one agent's 71, the same as plain debate."],
  "paper-camel": ["Hard computation (flash-lite): 12."],
  "paper-chateval": ["Hard computation (flash-lite): 12 (it is built to judge answers, not to give them)."],
  "paper-magentic-one": ["Hard computation (flash-lite): 30 of 30, its terminal running code in the sandbox.", "MATH-500 (50): 46; GSM-Hard (50): 39."],
  "paper-autogen": ["Hard computation (flash-lite): 30 with its executor; 28 with the model-free user proxy, at a fifth of the cost."],
  "paper-agentcoder": ["HumanEval (50): 48, as one agent; coding problems (31, two runs): 60 of 62."],
  "paper-mapcoder": ["HumanEval (50): 48, with one plan or three (a second plan was never needed)."],
  "paper-reflexion": ["HumanEval (50): 48, as one agent."],
  "paper-macnet": ["Hard computation (flash-lite), four nodes: chain 19, star 22, mesh 21; a star of 2, 4, 8 nodes: 19, 22, 21."],
  "paper-corex": ["Hard computation (flash-lite): 22, 22, the same as a majority vote over five samples, missing the same questions, at 1.6 times its cost."],
  "paper-mav": ["Hard computation (flash-lite): 22, 22, the same eight misses as the vote and Corex, at three times the vote's cost: on the misses the right answer was among the five candidates once in 16."],
  "paper-macm": ["MATH level 5 (50, flash-lite): 43, against one agent's 40, debate's 44 and a five-sample vote's 45 at the same cost; its Judge called the conditions sufficient after one mined condition in 43 of 50."],
  "paper-self-refine": ["Hard computation (flash-lite): 21, 21, as three-agent debate; its revisions moved 4 answers right and 3 wrong, and its critic never found an answer free of issues.", "MATH level 5 (50): 44, against one agent's 40; revisions 6 right, 2 wrong."],
  "paper-spp": [
    "Hard computation: 20, 22 on flash-lite (as debate), 25 on gemma (debate 26, one agent 27).",
    "MMLU medical (75): 73, 73, as MedAgents and debate, at a quarter of their cost.",
  ],
};
