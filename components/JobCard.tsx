"use client";

import { useState } from "react";
import type { JobState, JobStatus } from "@/lib/types";

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
}

export default function JobCard({ job, disabled, onRemove }: Props) {
  const [showOriginal, setShowOriginal] = useState(false);
  const busy = job.status === "normalizing" || job.status === "removing" || job.status === "compositing";
  const imageUrl = job.status === "done" && job.resultUrl && !showOriginal ? job.resultUrl : job.thumbUrl;

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
