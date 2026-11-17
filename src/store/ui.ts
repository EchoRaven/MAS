import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
const THEME_KEY = "mas-theme";
const NAV_KEY = "mas-nav-collapsed";

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
  /** the left navigation as an icon rail */
  navCollapsed: boolean;
  toggleNav: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: (read(THEME_KEY) as Theme | null) ?? "system",
  setTheme: (theme) => {
    write(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  navCollapsed: read(NAV_KEY) !== "0",
  toggleNav: () =>
    set((s) => {
      write(NAV_KEY, s.navCollapsed ? "0" : "1");
      return { navCollapsed: !s.navCollapsed };
    }),
}));
