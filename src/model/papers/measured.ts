// What each paper template scored on this platform, from docs/benchmarks.md: shown with the template, so
// whoever picks one knows how it did here, not only what its paper claims. "Hard computation" is the built-in
// 30-question set; flash-lite is gemini-3.1-flash-lite, where a single agent scores 19.
export const MEASURED: Record<string, string[]> = {
  "paper-debate": [
    "Hard computation (flash-lite): 21, 21 against one agent's 19; on the weaker gemma, 26 against 17.",
    "MMLU (100): 95.5 against 95.0 on flash-lite, 89 against 90 on gemma: no gain where errors are missing knowledge.",
    "With a sandbox per debater, MATH-500 (50): 47, the same as one agent with a sandbox, at four times the cost.",
  ],
  "paper-reconcile": ["Hard computation (flash-lite): 22, 22; on gemma 25.", "One seat per model (three models): 27.3 over three runs, the same as its strongest seat alone."],
  "paper-agent-forest": ["Hard computation (flash-lite): 22 with three samples, flat beyond; on gemma (five samples) 25."],
  "paper-eot": ["Hard computation (flash-lite): 23, the best score there without tools."],
  "paper-dylan": ["Hard computation (flash-lite): 22; a team of two chosen by learned importance: 20, at 24% less."],
  "paper-mad": ["Hard computation (flash-lite): 14, 14, below one agent: the devil argues the judge out of right products."],
  "paper-agentverse": ["Hard computation (flash-lite): 20; its evaluator scores wrong products 10/10."],
  "paper-autoagents": ["Hard computation (flash-lite): 13; its quality-assurance agent confirms wrong products."],
  "paper-moa": ["Hard computation (flash-lite): 17; with three different models proposing, 26, the same as the best of them alone."],
  "paper-medagents": ["Hard computation (flash-lite): 15.", "MMLU medical (75): 73 against one agent's 71, the same as plain debate."],
  "paper-camel": ["Hard computation (flash-lite): 12."],
  "paper-chateval": ["Hard computation (flash-lite): 12 (it is built to judge answers, not to give them)."],
  "paper-magentic-one": ["Hard computation (flash-lite): 30 of 30, its terminal running code in the sandbox.", "MATH-500 (50): 45; GSM-Hard (50): 39."],
  "paper-autogen": ["Hard computation (flash-lite): 30 with its executor; 28 with the model-free user proxy, at a fifth of the cost."],
  "paper-agentcoder": ["HumanEval (50): 48, as one agent; coding problems (31, two runs): 60 of 62."],
  "paper-mapcoder": ["HumanEval (50): 48, with one plan or three (a second plan was never needed)."],
  "paper-reflexion": ["HumanEval (50): 48, as one agent."],
  "paper-macnet": ["Hard computation (flash-lite), four nodes: chain 19, star 22, mesh 21; a star of 2, 4, 8 nodes: 19, 22, 21."],
  "paper-corex": ["Hard computation (flash-lite): 22, 22, the same as a majority vote over five samples, missing the same questions, at 1.6 times its cost."],
  "paper-mav": ["Hard computation (flash-lite): 22, 22, the same eight misses as the vote and Corex, at three times the vote's cost: on the misses the right answer was among the five candidates once in 16."],
  "paper-spp": [
    "Hard computation: 20, 22 on flash-lite (as debate), 25 on gemma (as debate, against one agent's 17).",
    "MMLU medical (75): 73, 73, as MedAgents and debate, at a quarter of their cost.",
  ],
};
