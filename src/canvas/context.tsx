import { createContext, useContext } from "react";

export interface CanvasContextValue {
  modelLabel: (id: string) => string;
}

export const CanvasContext = createContext<CanvasContextValue>({ modelLabel: (id) => id });

/** Edge editing from inside an edge component; absent on read-only canvases. */
export interface EdgeEditValue {
  /** save an edge's waypoints ([] = straight again) */
  setPoints?: (edgeId: string, points: { x: number; y: number }[]) => void;
}
export const EdgeEditContext = createContext<EdgeEditValue>({});
export const useCanvasContext = () => useContext(CanvasContext);
