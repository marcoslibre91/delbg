export type Provider = "local" | "photoroom" | "removebg";

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
  /** Provider that produced the cached cutout */
  cutoutProvider: Provider | null;
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
