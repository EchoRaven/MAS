import { Navigate, useParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useSystems } from "@/store/systems";
import { Editor } from "./Editor";

export function CanvasPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  if (!systemId) {
    if (systems.length) return <Navigate to={`/canvas/${systems[0].id}`} replace />;
    return <Navigate to="/" replace />;
  }
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  return (
    <ReactFlowProvider key={doc.id}>
      <Editor doc={doc} />
    </ReactFlowProvider>
  );
}
