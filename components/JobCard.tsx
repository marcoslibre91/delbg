"use client";

import { useEffect, useRef, useState } from "react";
import type { JobState, JobStatus, Provider } from "@/lib/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "In coda",
  normalizing: "Preparazione…",
  removing: "Scontorno…",
  compositing: "Sfondo…",
  done: "Fatta",
  error: "Errore",
  skipped: "Saltata",
};

interface Props {
  job: JobState;
  disabled: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string, provider: Provider) => void;
}

export default function JobCard({ job, disabled, onRemove, onRetry }: Props) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const busy = job.status === "normalizing" || job.status === "removing" || job.status === "compositing";
  const retriable = job.status === "done" || job.status === "error" || job.status === "skipped";
  const imageUrl = job.status === "done" && job.resultUrl && !showOriginal ? job.resultUrl : job.thumbUrl;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const retry = (provider: Provider) => {
    setMenuOpen(false);
    setShowOriginal(false);
    onRetry(job.id, provider);
  };

  // the local retry alternates between the two model variants
  const nextLocalVariant = job.localModel === "small" ? "medium" : "small";

  return (
    <figure className={`job-card status-${job.status}`}>
      <div
        className="job-image"
        onClick={() => job.status === "done" && setShowOriginal((v) => !v)}
        title={job.status === "done" ? "Clic per confrontare con l'originale" : undefined}
      >
        {imageUrl ? (
          // plain <img>: sources are local object URLs, next/image adds nothing here
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={job.name} loading="lazy" />
        ) : (
          <span className="job-placeholder">{busy ? "…" : "anteprima"}</span>
        )}
        {job.status === "done" && (
          <span className="job-compare">{showOriginal ? "originale" : "risultato"}</span>
        )}
      </div>
      <figcaption>
        <span className="job-name" title={job.name}>{job.name}</span>
        <span className={`job-status status-${job.status}`}>
          {busy && <span className="spinner" aria-hidden />}
          {STATUS_LABELS[job.status]}
        </span>
        {job.error && <span className="job-error" title={job.error}>{job.error}</span>}
      </figcaption>
      <div className="job-actions">
        {job.status === "done" && job.resultUrl && (
          <a href={job.resultUrl} download={job.outName ?? undefined} className="mini-btn" title="Scarica JPG">
            ⬇
          </a>
        )}
        {retriable && (
          <div className="retry-wrap" ref={menuRef}>
            <button
              type="button"
              className="mini-btn"
              disabled={disabled}
              title="Riprova lo scontorno di questa immagine"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ↻
            </button>
            {menuOpen && (
              <div className="retry-menu">
                <span className="retry-title">Riprova scontorno</span>
                <button type="button" onClick={() => retry("local")}>
                  Locale — variante {nextLocalVariant === "small" ? "S" : "M"} (gratis)
                </button>
                <button type="button" onClick={() => retry("photoroom")}>
                  PhotoRoom (~$0,02)
                </button>
                <button type="button" onClick={() => retry("removebg")}>
                  remove.bg (~$0,20)
                </button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="mini-btn"
          disabled={disabled}
          onClick={() => onRemove(job.id)}
          title="Rimuovi dalla lista"
        >
          ✕
        </button>
      </div>
    </figure>
  );
}
