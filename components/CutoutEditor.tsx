"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobState, Settings } from "@/lib/types";

type Tool = "wand" | "eraser";

const MAX_UNDO = 10;

/**
 * Magic wand: flood-erase the contiguous region whose color is within
 * `tolerance` (Euclidean RGB distance) of the clicked pixel. Same idea as
 * Photoshop's wand + delete, in one click.
 */
function floodErase(img: ImageData, startX: number, startY: number, tolerance: number): boolean {
  const { width, height, data } = img;
  const start = startY * width + startX;
  if (data[start * 4 + 3] === 0) return false; // clicked on transparency
  const r0 = data[start * 4];
  const g0 = data[start * 4 + 1];
  const b0 = data[start * 4 + 2];
  const maxDist2 = tolerance * tolerance;
  const visited = new Uint8Array(width * height);
  const stack = [start];
  visited[start] = 1;
  while (stack.length) {
    const p = stack.pop() as number;
    const i = p * 4;
    if (data[i + 3] === 0) continue;
    const dr = data[i] - r0;
    const dg = data[i + 1] - g0;
    const db = data[i + 2] - b0;
    if (dr * dr + dg * dg + db * db > maxDist2) continue;
    data[i + 3] = 0;
    const x = p % width;
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
    if (x < width - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
    if (p >= width && !visited[p - width]) { visited[p - width] = 1; stack.push(p - width); }
    if (p < width * (height - 1) && !visited[p + width]) { visited[p + width] = 1; stack.push(p + width); }
  }
  return true;
}

interface Props {
  job: JobState;
  settings: Settings;
  onSave: (id: string, cutout: Blob) => void;
  onClose: () => void;
}

export default function CutoutEditor({ job, settings, onSave, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const undoRef = useRef<ImageData[]>([]);
  const strokingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("wand");
  const [tolerance, setTolerance] = useState(40);
  const [brushSize, setBrushSize] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);

  // load the cutout at full resolution
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!job.cutout) return;
      const bitmap = await createImageBitmap(job.cutout);
      if (cancelled) {
        bitmap.close();
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(bitmap, 0, 0);
      bitmap.close();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [job.cutout]);

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    undoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = undoRef.current.pop();
    if (!canvas || !ctx || !snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    setCanUndo(undoRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, undo]);

  /** Map a pointer event to canvas-space coordinates. */
  const toCanvas = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    return { x, y };
  }, []);

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    [brushSize]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!ready) return;
      const point = toCanvas(e);
      if (!point) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) return;
      if (tool === "wand") {
        pushUndo();
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (floodErase(img, point.x, point.y, tolerance)) {
          ctx.putImageData(img, 0, 0);
        } else {
          undoRef.current.pop();
          setCanUndo(undoRef.current.length > 0);
        }
      } else {
        pushUndo();
        strokingRef.current = true;
        (e.target as Element).setPointerCapture(e.pointerId);
        eraseAt(point.x, point.y);
      }
    },
    [ready, tool, tolerance, toCanvas, pushUndo, eraseAt]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!strokingRef.current || tool !== "eraser") return;
      const point = toCanvas(e);
      if (point) eraseAt(point.x, point.y);
    },
    [tool, toCanvas, eraseAt]
  );

  const onPointerUp = useCallback(() => {
    strokingRef.current = false;
  }, []);

  const save = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    canvas.toBlob((blob) => {
      if (blob) onSave(job.id, blob);
      setSaving(false);
    }, "image/png");
  }, [job.id, onSave]);

  return (
    <div className="editor-overlay" role="dialog" aria-modal="true" aria-label={`Modifica ${job.name}`}>
      <div className="editor">
        <header className="editor-header">
          <h2>Ritocco — {job.name}</h2>
          <button type="button" className="mini-btn" onClick={onClose} title="Chiudi senza salvare">
            ✕
          </button>
        </header>

        <div className="editor-toolbar">
          <div className="segmented">
            <button
              type="button"
              className={tool === "wand" ? "selected" : ""}
              onClick={() => setTool("wand")}
              title="Clic su una zona: rimuove l'area contigua di colore simile"
            >
              🪄 Bacchetta
            </button>
            <button
              type="button"
              className={tool === "eraser" ? "selected" : ""}
              onClick={() => setTool("eraser")}
              title="Trascina per cancellare a mano"
            >
              🧽 Gomma
            </button>
          </div>
          {tool === "wand" ? (
            <label className="editor-slider">
              Tolleranza {tolerance}
              <input
                type="range"
                min={10}
                max={150}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="editor-slider">
              Pennello {brushSize}px
              <input
                type="range"
                min={8}
                max={160}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
            </label>
          )}
          <div className="segmented">
            {[1, 2, 3].map((z) => (
              <button
                key={z}
                type="button"
                className={zoom === z ? "selected" : ""}
                onClick={() => setZoom(z)}
              >
                {z}×
              </button>
            ))}
          </div>
          <button type="button" className="btn small" onClick={undo} disabled={!canUndo}>
            ↩ Annulla
          </button>
        </div>

        <div className="editor-canvas-wrap" style={{ backgroundColor: settings.backgroundColor }}>
          <canvas
            ref={canvasRef}
            style={{ width: `${100 * zoom}%` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>

        <footer className="editor-footer">
          <small className="field-hint">
            Bacchetta: un clic rimuove la zona contigua di colore simile (es. il braccio). Gomma: trascina per
            rifinire. L&apos;anteprima è già sul colore di sfondo scelto.
          </small>
          <div className="button-row">
            <button type="button" className="btn" onClick={onClose}>
              Annulla modifiche
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={!ready || saving}>
              {saving ? "Salvataggio…" : "Salva e ricomponi"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
