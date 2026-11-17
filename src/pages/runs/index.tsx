import { Navigate, useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useSystems } from "@/store/systems";
import { RunView } from "./RunView";

export function RunsPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  if (!systemId) return systems.length ? <Navigate to={`/runs/${systems[0].id}`} replace /> : <Navigate to="/" replace />;
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  return (
    <ReactFlowProvider key={doc.id}>
      <RunView doc={doc} />
    </ReactFlowProvider>
  );
}
