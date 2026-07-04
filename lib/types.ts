export type Provider = "local" | "photoroom" | "removebg";

/** Variant of the in-browser model; "medium" is the default quality. */
export type LocalModel = "small" | "medium";

export type OutputFormat = "original" | "square";

export interface Settings {
  provider: Provider;
  backgroundColor: string;
  jpegQuality: number; // 0..1
  outputFormat: OutputFormat;
  squareSize: number;
  marginPercent: number;
  parallelJobs: number;
  photoroomKey: string;
  removebgKey: string;
  /** Variant of the local model for this run (default "medium") */
  localModel?: LocalModel;
  /**
   * Recomposite-only mode: reuse each job's cached cutout whatever provider
   * produced it (no provider calls) — used for "apply new color/format".
   */
  reuseAnyCutout?: boolean;
}

/** Cache key identifying which provider+variant produced a cutout. */
export function cutoutKeyFor(settings: Settings): string {
  return settings.provider === "local"
    ? `local:${settings.localModel ?? "medium"}`
    : settings.provider;
}

export type JobStatus =
  | "queued"
  | "normalizing"
  | "removing"
  | "compositing"
  | "done"
  | "error"
  | "skipped";

export interface JobState {
  id: string;
  name: string;
  file: File;
  /** Object URL of a small preview thumbnail (generated locally, HEIC included) */
  thumbUrl: string | null;
  status: JobStatus;
  error: string | null;
  /** Normalized full-size JPEG blob (EXIF applied, RGB), reused across runs */
  normalized: Blob | null;
  /** PNG cutout with alpha, cached so a re-run never pays the API twice */
  cutout: Blob | null;
  /** Cache key (provider or local:variant) that produced the cached cutout */
  cutoutKey: string | null;
  /** Local model variant used for the last local run on this job */
  localModel: LocalModel | null;
  /** One-shot per-job variant override for the next local run (batch retry) */
  retryModel?: LocalModel | null;
  /** Ticked in the grid for batch reprocessing */
  selected: boolean;
  /** Automatic QC warning (e.g. possible hand/arm left in the cutout) */
  warning: string | null;
  result: Blob | null;
  resultUrl: string | null;
  outName: string | null;
  width: number;
  height: number;
}

export interface LogEntry {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

export type ProviderErrorKind = "fatal" | "retryable" | "skip";

/** What /api/config reveals to the client. */
export interface ServerConfig {
  passwordRequired: boolean;
  authorized: boolean;
  /** Which providers have a key configured server-side (null until authorized) */
  serverKeys: { photoroom: boolean; removebg: boolean } | null;
}

export const PROVIDER_PRICES: Record<Provider, number> = {
  local: 0,
  photoroom: 0.02,
  removebg: 0.2,
};
