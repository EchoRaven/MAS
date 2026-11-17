import { createContext, useContext } from "react";

export interface CanvasContextValue {
  modelLabel: (id: string) => string;
}

export const CanvasContext = createContext<CanvasContextValue>({ modelLabel: (id) => id });
export const useCanvasContext = () => useContext(CanvasContext);
