import { AgentNode, FunctionNode, HumanNode, ModelNode } from "./components";
import { BoundaryNode, GroupNode } from "./group";
import { EnvNode, PluginNode } from "./resources";

export { PLUGIN_ICON } from "./resources";
export { TYPE_DOT } from "./parts";

export const NODE_TYPES = {
  agent: AgentNode,
  model: ModelNode,
  function: FunctionNode,
  human: HumanNode,
  env: EnvNode,
  plugin: PluginNode,
  group: GroupNode,
  boundary: BoundaryNode,
};
