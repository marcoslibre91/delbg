import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  provider: "local",
  backgroundColor: "#F2EDE7", // il "neutro" scelto dal cliente
  jpegQuality: 0.92,
  outputFormat: "original",
  squareSize: 2000,
  marginPercent: 12,
  parallelJobs: 3,
  photoroomKey: "",
  removebgKey: "",
};

export const COLOR_PRESETS = ["#F2EDE7", "#FFFFFF", "#F5F5F5", "#E8E8E8"];

const STORAGE_KEY = "delbg-settings-v1";
const PASSWORD_KEY = "delbg-app-password";

export function loadAppPassword(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAppPassword(password: string): void {
  try {
    window.localStorage.setItem(PASSWORD_KEY, password);
  } catch {
    // storage unavailable: the user will just be asked again next visit
  }
}

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
