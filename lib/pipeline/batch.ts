import { cutoutKeyFor, type JobState, type Settings } from "../types";
import { normalizeImage } from "./normalize";
import { ProviderError, removeBackgroundWith } from "./providers";
import { compositeCutout } from "./composite";
import {
  analyzeCutout,
  HOLE_WARN_THRESHOLD,
  HOLE_WARNING_MESSAGE,
  SKIN_WARN_THRESHOLD,
  SKIN_WARNING_MESSAGE,
} from "./qc";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 4000, 8000];

export interface BatchCallbacks {
  onJob: (id: string, patch: Partial<JobState>) => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  onProgress: (done: number, total: number) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Interrotto", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs the queue with a worker pool. Skips failed images without stopping
 * the batch; a fatal provider error (invalid key, credits exhausted) aborts
 * everything so no further paid calls are wasted. Cutouts are cached on the
 * job, so re-running a batch never pays the provider twice for an image
 * that already succeeded.
 */
export async function runBatch(
  jobs: JobState[],
  settings: Settings,
  cb: BatchCallbacks,
  signal: AbortSignal
): Promise<void> {
  // the in-browser models gain nothing from parallel inference; API providers do
  const concurrency =
    settings.provider === "local" || settings.provider === "localhq"
      ? 1
      : Math.max(1, settings.parallelJobs);
  const queue = [...jobs];
  const total = jobs.length;
  let done = 0;
  let fatal = false;

  const processJob = async (job: JobState): Promise<void> => {
    try {
      let normalized = job.normalized;
      if (!normalized) {
        cb.onJob(job.id, { status: "normalizing", error: null });
        const result = await normalizeImage(job.file);
        normalized = result.blob;
        cb.onJob(job.id, { normalized, width: result.width, height: result.height });
      } else {
        cb.onJob(job.id, { status: "normalizing", error: null });
      }

      // per-job variant override (batch retry alternates each image's variant)
      const effective: Settings =
        settings.provider === "local" && job.retryModel
          ? { ...settings, localModel: job.retryModel }
          : settings;
      const targetKey = cutoutKeyFor(effective);
      // reuse the cached cutout when it comes from the same provider+variant,
      // or from any provider in recomposite-only mode (color/format change)
      let cutout =
        job.cutout && (job.cutoutKey === targetKey || settings.reuseAnyCutout)
          ? job.cutout
          : null;
      if (!cutout) {
        cb.onJob(job.id, { status: "removing" });
        for (let attempt = 1; ; attempt++) {
          try {
            cutout = await removeBackgroundWith(effective.provider, normalized, effective, signal);
            break;
          } catch (err) {
            if (signal.aborted) throw err;
            if (err instanceof ProviderError && err.kind === "retryable" && attempt < MAX_ATTEMPTS) {
              const wait = err.retryAfterMs ?? BACKOFF_MS[attempt - 1];
              cb.onLog(
                "warn",
                `${job.name}: ${err.message} — nuovo tentativo ${attempt + 1}/${MAX_ATTEMPTS} tra ${Math.round(wait / 1000)}s`
              );
              await sleep(wait, signal);
              continue;
            }
            throw err;
          }
        }
        cb.onJob(job.id, {
          cutout,
          cutoutKey: targetKey,
          retryModel: null,
          localModel:
            effective.provider === "local" ? effective.localModel ?? "medium" : job.localModel,
        });

        // automatic QC on fresh cutouts: flag and pre-select suspicious results
        try {
          const analysis = await analyzeCutout(cutout);
          const problems: string[] = [];
          if (analysis.skinRatio > SKIN_WARN_THRESHOLD) {
            problems.push(SKIN_WARNING_MESSAGE);
            cb.onLog(
              "warn",
              `${job.name}: possibile mano/braccio nel ritaglio (${Math.round(analysis.skinRatio * 100)}% di pelle) — pre-selezionata`
            );
          }
          if (analysis.holeRatio > HOLE_WARN_THRESHOLD) {
            problems.push(HOLE_WARNING_MESSAGE);
            cb.onLog(
              "warn",
              `${job.name}: possibile parte interna rimossa (buco interno ${Math.round(analysis.holeRatio * 100)}% del soggetto) — usa Riempi buchi nell'editor`
            );
          }
          if (problems.length) {
            cb.onJob(job.id, { warning: problems.join(" · "), selected: true });
          } else {
            cb.onJob(job.id, { warning: null });
          }
        } catch (qcError) {
          // QC is best-effort: never fail a job because of it
          cb.onLog("warn", `${job.name}: controllo qualità non riuscito (${String(qcError)})`);
        }
      } else {
        cb.onLog("info", `${job.name}: scontorno già in cache, nessuna nuova chiamata`);
      }

      cb.onJob(job.id, { status: "compositing" });
      const composed = await compositeCutout(cutout, settings);
      cb.onJob(job.id, {
        status: "done",
        result: composed.blob,
        width: composed.width,
        height: composed.height,
        error: null,
      });
      cb.onLog("info", `${job.name}: completata (${composed.width}×${composed.height})`);
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        cb.onJob(job.id, { status: "queued" });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ProviderError && err.kind === "fatal") {
        fatal = true;
        cb.onJob(job.id, { status: "error", error: message });
        cb.onLog("error", `${job.name}: ${message} — batch interrotto per evitare altre chiamate a vuoto`);
        return;
      }
      const status = err instanceof ProviderError && err.kind === "skip" ? "skipped" : "error";
      cb.onJob(job.id, { status, error: message });
      cb.onLog("error", `${job.name}: ${message} — immagine saltata, il batch continua`);
    } finally {
      done += 1;
      cb.onProgress(done, total);
    }
  };

  const worker = async (): Promise<void> => {
    while (!fatal && !signal.aborted) {
      const job = queue.shift();
      if (!job) return;
      await processJob(job);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fatal) {
    throw new Error("Batch interrotto per un errore bloccante: dettagli nel log qui sopra");
  }
}
