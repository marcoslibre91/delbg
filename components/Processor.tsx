"use client";

import { useCallback, useRef, useState } from "react";
import {
  cutoutKeyFor,
  PROVIDER_PRICES,
  type JobState,
  type LocalModel,
  type LogEntry,
  type Provider,
  type ServerConfig,
  type Settings,
} from "@/lib/types";
import { isValidHex, loadSettings, saveSettings } from "@/lib/settings";
import { isSupportedImage, makeThumbnail } from "@/lib/pipeline/normalize";
import { makeOutputNamer } from "@/lib/pipeline/naming";
import { runBatch } from "@/lib/pipeline/batch";
import {
  driveConfig,
  downloadDriveFile,
  pickImages,
  pickOutputFolder,
  uploadToDrive,
  type DrivePickedFolder,
} from "@/lib/drive/google";
import { compositeCutout } from "@/lib/pipeline/composite";
import SettingsPanel from "./SettingsPanel";
import ApiKeysPanel from "./ApiKeysPanel";
import JobCard from "./JobCard";
import LogPanel from "./LogPanel";
import CutoutEditor from "./CutoutEditor";

let jobCounter = 0;

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default function Processor({ serverConfig }: { serverConfig: ServerConfig | null }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outputFolder, setOutputFolder] = useState<DrivePickedFolder | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const namerRef = useRef(makeOutputNamer());
  const driveReady = driveConfig() !== null;

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const time = new Date().toLocaleTimeString("it-IT");
    setLog((prev) => [{ time, level, message }, ...prev].slice(0, 300));
  }, []);

  const patchJob = useCallback((id: string, patch: Partial<JobState>) => {
    setJobs((prev) =>
      prev.map((job) => {
        if (job.id !== id) return job;
        const next = { ...job, ...patch };
        if (patch.result) {
          if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
          next.resultUrl = URL.createObjectURL(patch.result);
        }
        return next;
      })
    );
  }, []);

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const supported = incoming.filter(isSupportedImage);
      const skipped = incoming.length - supported.length;
      if (skipped > 0) {
        addLog("warn", `${skipped} file ignorati: formati supportati HEIC, JPG, PNG, WEBP`);
      }
      if (!supported.length) return;

      const newJobs: JobState[] = supported.map((file) => ({
        id: `job-${++jobCounter}`,
        name: file.name,
        file,
        thumbUrl: null,
        status: "queued",
        error: null,
        normalized: null,
        cutout: null,
        cutoutKey: null,
        localModel: null,
        selected: false,
        warning: null,
        result: null,
        resultUrl: null,
        outName: namerRef.current(file.name),
        width: 0,
        height: 0,
      }));
      setJobs((prev) => [...prev, ...newJobs]);
      addLog("info", `${newJobs.length} immagini aggiunte alla coda`);

      // thumbnails in background (HEIC decode is the slow part)
      await mapWithConcurrency(newJobs, 2, async (job) => {
        try {
          const thumb = await makeThumbnail(job.file);
          patchJob(job.id, { thumbUrl: URL.createObjectURL(thumb) });
        } catch {
          addLog("warn", `${job.name}: anteprima non generata`);
        }
      });
    },
    [addLog, patchJob]
  );

  const importFromDrive = useCallback(async () => {
    setImporting(true);
    try {
      const picked = await pickImages();
      if (!picked.length) return;
      addLog("info", `Scarico ${picked.length} file da Google Drive…`);
      const files: File[] = [];
      await mapWithConcurrency(picked, 3, async (item) => {
        try {
          files.push(await downloadDriveFile(item));
        } catch (err) {
          addLog("error", err instanceof Error ? err.message : String(err));
        }
      });
      await addFiles(files);
    } catch (err) {
      addLog("error", err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [addFiles, addLog]);

  const runJobs = useCallback(
    async (snapshot: JobState[], effective: Settings, label: string) => {
      if (!snapshot.length) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setProgress({ done: 0, total: snapshot.length });
      const ids = new Set(snapshot.map((j) => j.id));
      setJobs((prev) =>
        prev.map((j) => (ids.has(j.id) ? { ...j, status: "queued", error: null } : j))
      );
      addLog("info", label);
      try {
        await runBatch(
          snapshot,
          effective,
          {
            onJob: patchJob,
            onLog: addLog,
            onProgress: (done, total) => setProgress({ done, total }),
          },
          controller.signal
        );
        addLog("info", "Batch completato");
      } catch (err) {
        addLog("error", err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [addLog, patchJob]
  );

  const startPending = useCallback(() => {
    // only images without a good result; cached cutouts are reused per provider
    const snapshot = jobs.filter((j) => j.status !== "done");
    void runJobs(
      snapshot,
      settings,
      `Batch avviato: ${snapshot.length} immagini, provider ${settings.provider}, sfondo ${settings.backgroundColor}`
    );
  }, [jobs, settings, runJobs]);

  const reapplyAll = useCallback(() => {
    // recomposite everything from existing cutouts: new color/format at zero cost
    void runJobs(
      [...jobs],
      { ...settings, reuseAnyCutout: true },
      `Riapplico sfondo ${settings.backgroundColor} e formato ${settings.outputFormat} a ${jobs.length} immagini (nessuna nuova chiamata)`
    );
  }, [jobs, settings, runJobs]);

  const toggleSelect = useCallback((id: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, selected: !j.selected } : j)));
  }, []);

  const selectFailed = useCallback(() => {
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "error" || j.status === "skipped" ? { ...j, selected: true } : j
      )
    );
  }, []);

  const deselectAll = useCallback(() => {
    setJobs((prev) => prev.map((j) => (j.selected ? { ...j, selected: false } : j)));
  }, []);

  const retrySelected = useCallback(
    (provider: Provider) => {
      const chosen = jobs.filter((j) => j.selected);
      if (!chosen.length || running) return;
      // fresh copies with the cutout cache invalidated: retry must re-segment.
      // With the local provider each image alternates its own model variant.
      const fresh: JobState[] = chosen.map((j) => ({
        ...j,
        selected: false,
        warning: null,
        cutout: null,
        cutoutKey: null,
        retryModel:
          provider === "local"
            ? ((j.localModel === "small" ? "medium" : "small") as LocalModel)
            : null,
      }));
      setJobs((prev) =>
        prev.map((j) =>
          j.selected
            ? { ...j, selected: false, warning: null, cutout: null, cutoutKey: null }
            : j
        )
      );
      const providerNames: Record<Provider, string> = {
        local: "modello locale (variante alternativa per ciascuna)",
        localhq: "Locale HQ (BiRefNet)",
        photoroom: "PhotoRoom",
        removebg: "remove.bg",
      };
      const label = `Riprovo ${fresh.length} immagini con ${providerNames[provider]}`;
      void runJobs(fresh, { ...settings, provider }, label);
    },
    [jobs, running, settings, runJobs]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    addLog("warn", "Interruzione richiesta: le immagini in corso vengono fermate");
  }, [addLog]);

  const saveEditedCutout = useCallback(
    async (id: string, cutout: Blob) => {
      const job = jobs.find((j) => j.id === id);
      setEditingId(null);
      if (!job) return;
      try {
        const composed = await compositeCutout(cutout, settings);
        patchJob(id, {
          cutout,
          cutoutKey: job.cutoutKey ? `${job.cutoutKey}+edit` : "manual-edit",
          warning: null,
          selected: false,
          status: "done",
          result: composed.blob,
          width: composed.width,
          height: composed.height,
          error: null,
        });
        addLog("info", `${job.name}: ritocco manuale applicato`);
      } catch (err) {
        addLog("error", `${job.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [jobs, settings, patchJob, addLog]
  );

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.thumbUrl) URL.revokeObjectURL(job.thumbUrl);
      if (job?.resultUrl) URL.revokeObjectURL(job.resultUrl);
      return prev.filter((j) => j.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setJobs((prev) => {
      prev.forEach((job) => {
        if (job.thumbUrl) URL.revokeObjectURL(job.thumbUrl);
        if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
      });
      return [];
    });
    namerRef.current = makeOutputNamer();
    setProgress({ done: 0, total: 0 });
  }, []);

  const downloadZip = useCallback(async () => {
    const completed = jobs.filter((j) => j.status === "done" && j.result);
    if (!completed.length) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    completed.forEach((job) => zip.file(job.outName ?? `${job.id}.jpg`, job.result as Blob));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "immagini_processate.zip";
    anchor.click();
    URL.revokeObjectURL(url);
    addLog("info", `ZIP scaricato con ${completed.length} immagini`);
  }, [jobs, addLog]);

  const uploadOutputs = useCallback(async () => {
    const completed = jobs.filter((j) => j.status === "done" && j.result);
    if (!completed.length) return;
    setUploading(true);
    try {
      let folder = outputFolder;
      if (!folder) {
        folder = await pickOutputFolder();
        if (!folder) return;
        setOutputFolder(folder);
      }
      addLog("info", `Carico ${completed.length} immagini in "${folder.name}" su Drive…`);
      let ok = 0;
      for (const job of completed) {
        try {
          await uploadToDrive(job.result as Blob, job.outName ?? `${job.id}.jpg`, folder.id);
          ok += 1;
        } catch (err) {
          addLog("error", err instanceof Error ? err.message : String(err));
        }
      }
      addLog(ok === completed.length ? "info" : "warn", `Upload su Drive: ${ok}/${completed.length} riuscite`);
    } catch (err) {
      addLog("error", err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [jobs, outputFolder, addLog]);

  const doneCount = jobs.filter((j) => j.status === "done").length;
  const failedCount = jobs.filter((j) => j.status === "error" || j.status === "skipped").length;
  const selectedCount = jobs.filter((j) => j.selected).length;
  const pendingCount = jobs.length - doneCount;
  const canRun = !running && !importing && isValidHex(settings.backgroundColor);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  // defective cost estimate: only the pending images that will REALLY call the
  // paid API (cached cutouts and the local model cost nothing)
  const targetKey = cutoutKeyFor(settings);
  const apiCallCount =
    PROVIDER_PRICES[settings.provider] === 0
      ? 0
      : jobs.filter(
          (j) => j.status !== "done" && !(j.cutout && j.cutoutKey === targetKey)
        ).length;
  const estimatedCost = apiCallCount * PROVIDER_PRICES[settings.provider];

  return (
    <div className="layout">
      <main>
        <section
          className={`panel dropzone${dragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <h2>Immagini</h2>
          <p className="dropzone-hint">
            Trascina qui le foto oppure selezionale. Formati: HEIC, JPG, PNG, WEBP.
          </p>
          <div className="button-row">
            <label className="btn">
              Scegli file
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                multiple
                hidden
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!driveReady || importing || running}
              title={
                driveReady
                  ? "Seleziona le immagini dal Drive condiviso"
                  : "Da configurare: NEXT_PUBLIC_GOOGLE_CLIENT_ID e NEXT_PUBLIC_GOOGLE_API_KEY (vedi README)"
              }
              onClick={() => void importFromDrive()}
            >
              {importing ? "Importazione…" : "Da Google Drive"}
            </button>
            {jobs.length > 0 && (
              <button type="button" className="btn subtle" disabled={running} onClick={clearAll}>
                Svuota lista
              </button>
            )}
          </div>
          {!driveReady && (
            <p className="drive-note">
              Google Drive non ancora collegato: servono le credenziali del progetto Google Cloud (istruzioni nel
              README). Nel frattempo puoi caricare i file dal computer.
            </p>
          )}
        </section>

        {jobs.length > 0 && (
          <section className="panel">
            <div className="run-row">
              <button
                type="button"
                className="btn primary"
                disabled={!canRun || pendingCount === 0}
                onClick={startPending}
              >
                {running ? "In corso…" : `Processa ${pendingCount} immagini`}
              </button>
              {!running && apiCallCount > 0 && (
                <span className="cost-estimate" title="Solo le immagini che chiameranno davvero l'API: scontorni in cache e modello locale non costano nulla">
                  ≈ ${estimatedCost.toFixed(2)} ({apiCallCount} scontorni con {settings.provider === "photoroom" ? "PhotoRoom" : "remove.bg"})
                </span>
              )}
              {doneCount > 0 && (
                <button
                  type="button"
                  className="btn"
                  disabled={!canRun}
                  title="Ricompone tutte le immagini col colore/formato attuale riusando gli scontorni: nessuna nuova chiamata"
                  onClick={reapplyAll}
                >
                  Riapplica colore/formato a tutte
                </button>
              )}
              {running && (
                <button type="button" className="btn danger" onClick={stop}>
                  Ferma
                </button>
              )}
              {failedCount > 0 && !running && (
                <button type="button" className="btn subtle" onClick={selectFailed}>
                  Seleziona non riuscite ({failedCount})
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!doneCount || running}
                onClick={() => void downloadZip()}
              >
                Scarica ZIP ({doneCount})
              </button>
              <button
                type="button"
                className="btn"
                disabled={!doneCount || running || uploading || !driveReady}
                title={driveReady ? undefined : "Richiede la configurazione Google Drive"}
                onClick={() => void uploadOutputs()}
              >
                {uploading ? "Upload…" : outputFolder ? `Su Drive → ${outputFolder.name}` : "Carica su Drive"}
              </button>
              {outputFolder && !uploading && (
                <button type="button" className="btn subtle" onClick={() => setOutputFolder(null)}>
                  Cambia cartella
                </button>
              )}
            </div>
            {(running || progress.total > 0) && (
              <div className="progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="progress-text">
                  {progress.done}/{progress.total} · {doneCount} ok
                  {failedCount > 0 ? ` · ${failedCount} fallite` : ""}
                </span>
              </div>
            )}
            <div className="job-grid">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  disabled={running}
                  onRemove={removeJob}
                  onToggleSelect={toggleSelect}
                  onEdit={setEditingId}
                />
              ))}
            </div>
          </section>
        )}

        {selectedCount > 0 && !running && (
          <div className="action-bar" role="toolbar" aria-label="Azioni sulle immagini selezionate">
            <span className="action-count">
              {selectedCount} {selectedCount === 1 ? "selezionata" : "selezionate"} — riprova scontorno con:
            </span>
            <button type="button" className="btn" onClick={() => retrySelected("local")}>
              Locale — variante alternativa (gratis)
            </button>
            <button type="button" className="btn" onClick={() => retrySelected("localhq")}>
              Locale HQ (gratis)
            </button>
            <button type="button" className="btn" onClick={() => retrySelected("photoroom")}>
              PhotoRoom ≈ ${(selectedCount * PROVIDER_PRICES.photoroom).toFixed(2)}
            </button>
            <button type="button" className="btn" onClick={() => retrySelected("removebg")}>
              remove.bg ≈ ${(selectedCount * PROVIDER_PRICES.removebg).toFixed(2)}
            </button>
            <button type="button" className="btn subtle" onClick={deselectAll}>
              Deseleziona
            </button>
          </div>
        )}

        <LogPanel entries={log} />

        {editingId && (() => {
          const job = jobs.find((j) => j.id === editingId);
          if (!job?.cutout) return null;
          return (
            <CutoutEditor
              job={job}
              settings={settings}
              onSave={(id, cutout) => void saveEditedCutout(id, cutout)}
              onClose={() => setEditingId(null)}
            />
          );
        })()}
      </main>

      <aside>
        <SettingsPanel
          settings={settings}
          serverConfig={serverConfig}
          disabled={running}
          onChange={updateSettings}
        />
        <ApiKeysPanel
          settings={settings}
          serverConfig={serverConfig}
          disabled={running}
          onChange={updateSettings}
        />
      </aside>
    </div>
  );
}
