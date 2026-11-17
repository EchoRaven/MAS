// Multi-agent systems from published papers, rebuilt with the framework's components.
import type { TemplateInfo } from "../builder";
import { agentcoder } from "./agentcoder";
import { agentverse } from "./agentverse";
import { autogen } from "./autogen";
import { camel } from "./camel";
import { chatdev } from "./chatdev";
import { chainOfAgents } from "./chainOfAgents";
import { chateval } from "./chateval";
import { debate } from "./debate";
import { dylan } from "./dylan";
import { generativeAgents } from "./generativeAgents";
import { mad } from "./mad";
import { magenticOne } from "./magenticOne";
import { mapcoder } from "./mapcoder";
import { medagents } from "./medagents";
import { metagpt } from "./metagpt";
import { moa } from "./moa";
import { reconcile } from "./reconcile";
import { reflexion } from "./reflexion";
import { tradingagents } from "./tradingagents";
import { voyager } from "./voyager";
import { werewolf } from "./werewolf";

export const PAPER_TEMPLATES: TemplateInfo[] = [chatdev, metagpt, debate, generativeAgents, moa, magenticOne, camel, autogen, agentcoder, agentverse, chateval, mapcoder, voyager, reflexion, dylan, tradingagents, werewolf, chainOfAgents, mad, reconcile, medagents];
