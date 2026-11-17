// Multi-agent systems from published papers, rebuilt with the framework's components.
import type { TemplateInfo } from "../builder";
import { agentcoder } from "./agentcoder";
import { agentverse } from "./agentverse";
import { autogen } from "./autogen";
import { camel } from "./camel";
import { chatdev } from "./chatdev";
import { debate } from "./debate";
import { generativeAgents } from "./generativeAgents";
import { magenticOne } from "./magenticOne";
import { metagpt } from "./metagpt";
import { moa } from "./moa";

export const PAPER_TEMPLATES: TemplateInfo[] = [chatdev, metagpt, debate, generativeAgents, moa, magenticOne, camel, autogen, agentcoder, agentverse];
