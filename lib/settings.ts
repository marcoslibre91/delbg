import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  provider: "local",
  backgroundColor: "#F5F5F5",
  jpegQuality: 0.92,
  outputFormat: "original",
  squareSize: 2000,
  marginPercent: 12,
  parallelJobs: 3,
  photoroomKey: "",
  removebgKey: "",
};

export const COLOR_PRESETS = ["#FFFFFF", "#F5F5F5", "#EFEBE2", "#E8E8E8"];

const STORAGE_KEY = "delbg-settings-v1";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage full or unavailable: settings just won't persist
  }
}

export function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
