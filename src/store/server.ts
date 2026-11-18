// Connection to the MAS Studio server. Without one the studio still works:
// systems stay in this browser and runs are simulated.
import { create } from "zustand";
import { Api, ApiError, getToken, setToken } from "@/api/client";

export type ServerStatus = "checking" | "offline" | "needs_token" | "connected";

interface ServerState {
  status: ServerStatus;
  error?: string;
  localExec: boolean;
  /** the server's model requests per minute (MAS_RPM) */
  rpm: number;
  check: () => Promise<void>;
  connect: (token: string) => Promise<boolean>;
  disconnect: () => void;
}

export const useServer = create<ServerState>((set) => ({
  status: "checking",
  localExec: false,
  rpm: 60,
  check: async () => {
    try {
      await Api.health();
    } catch {
      set({ status: "offline", error: "No server answered at /api" });
      return;
    }
    if (!getToken()) {
      set({ status: "needs_token", error: undefined });
      return;
    }
    try {
      const s = await Api.session();
      set({ status: "connected", error: undefined, localExec: s.local_exec, rpm: s.rpm ?? 60 });
    } catch (e) {
      set({ status: e instanceof ApiError && e.status === 401 ? "needs_token" : "offline", error: (e as Error).message });
    }
  },
  connect: async (token) => {
    try {
      const s = await Api.session(token.trim());
      setToken(token.trim());
      set({ status: "connected", error: undefined, localExec: s.local_exec, rpm: s.rpm ?? 60 });
      return true;
    } catch (e) {
      set({ error: e instanceof ApiError && e.status === 401 ? "That token is not right" : (e as Error).message });
      return false;
    }
  },
  disconnect: () => {
    setToken("");
    set({ status: "needs_token" });
  },
}));
