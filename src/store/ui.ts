import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
const THEME_KEY = "mas-theme";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function systemDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? (systemDark() ? "dark" : "light") : theme;
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

interface UiState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: (read(THEME_KEY) as Theme | null) ?? "system",
  setTheme: (theme) => {
    write(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
}));
