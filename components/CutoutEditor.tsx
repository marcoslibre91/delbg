"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobState, Settings } from "@/lib/types";
import { isSkin } from "@/lib/pipeline/qc";

type Tool = "wand" | "eraser" | "restore";

const MAX_UNDO = 10;

/**
 * Chroma-weighted color distance (YCbCr): shading changes luminance but not
 * hue, so weighting Cb/Cr more lets the wand grab a whole shaded arm in one
 * click without a huge tolerance.
 */
function colorDist2(
  r1: number, g1: number, b1: number,
  r0: number, g0: number, b0: number
): number {
  const dr = r1 - r0;
  const dg = g1 - g0;
  const db = b1 - b0;
  const dy = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const dcb = -0.168736 * dr - 0.331264 * dg + 0.5 * db;
  const dcr = 0.5 * dr - 0.418688 * dg - 0.081312 * db;
  return 0.7 * 0.7 * dy * dy + 1.8 * 1.8 * (dcb * dcb + dcr * dcr);
}

/** Magic wand: flood-erase the contiguous region similar to the clicked pixel. */
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
    if (colorDist2(data[i], data[i + 1], data[i + 2], r0, g0, b0) > maxDist2) continue;
    data[i + 3] = 0;
    const x = p % width;
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
    if (x < width - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
    if (p >= width && !visited[p - width]) { visited[p - width] = 1; stack.push(p - width); }
    if (p < width * (height - 1) && !visited[p + width]) { visited[p + width] = 1; stack.push(p + width); }
  }
  return true;
}

/** Erase every skin-colored pixel (QC rule), dilated to catch blended edges. */
function eraseSkin(img: ImageData): number {
  const { width, height, data } = img;
  let mask = new Uint8Array(width * height);
  let found = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (data[i + 3] > 0 && isSkin(data[i], data[i + 1], data[i + 2])) {
      mask[p] = 1;
      found += 1;
    }
  }
  if (!found) return 0;
  // dilate twice: pink fringes blend into neighbours
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(mask);
    for (let p = 0; p < width * height; p++) {
      if (mask[p]) continue;
      const x = p % width;
      if (
        (x > 0 && mask[p - 1]) ||
        (x < width - 1 && mask[p + 1]) ||
        (p >= width && mask[p - width]) ||
        (p < width * (height - 1) && mask[p + width])
      ) {
        next[p] = 1;
      }
    }
    mask = next;
  }
  for (let p = 0; p < width * height; p++) {
    if (mask[p]) data[p * 4 + 3] = 0;
  }
  return found;
}

/** Defringe: erode the alpha edge by 1px, then soften it with a 3×3 blur. */
function cleanEdges(img: ImageData): void {
  const { width, height, data } = img;
  const alpha = new Uint8ClampedArray(width * height);
  for (let p = 0; p < width * height; p++) alpha[p] = data[p * 4 + 3];
  const eroded = new Uint8ClampedArray(alpha);
  for (let p = 0; p < width * height; p++) {
    const x = p % width;
    let min = alpha[p];
    if (x > 0 && alpha[p - 1] < min) min = alpha[p - 1];
    if (x < width - 1 && alpha[p + 1] < min) min = alpha[p + 1];
    if (p >= width && alpha[p - width] < min) min = alpha[p - width];
    if (p < width * (height - 1) && alpha[p + width] < min) min = alpha[p + width];
    eroded[p] = min;
  }
  for (let p = 0; p < width * height; p++) {
    const x = p % width;
    const y = (p / width) | 0;
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        sum += eroded[yy * width + xx];
        count += 1;
      }
    }
    data[p * 4 + 3] = Math.round(sum / count);
  }
}

interface Props {
  job: JobState;
  settings: Settings;
  onSave: (id: string, cutout: Blob) => void;
  onClose: () => void;
}

export default function CutoutEditor({ job, settings, onSave, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Original photo scaled to the cutout size: source for the restore brush */
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const undoRef = useRef<ImageData[]>([]);
  const strokingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [hasOriginal, setHasOriginal] = useState(false);
  const [tool, setTool] = useState<Tool>("wand");
  const [tolerance, setTolerance] = useState(40);
  const [brushSize, setBrushSize] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);

  // load the cutout at full resolution + the original photo for the restore brush
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
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);

      if (job.normalized) {
        const original = await createImageBitmap(job.normalized);
        if (!cancelled) {
          const off = document.createElement("canvas");
          off.width = bitmap.width;
          off.height = bitmap.height;
          off.getContext("2d")?.drawImage(original, 0, 0, bitmap.width, bitmap.height);
          originalRef.current = off;
          setHasOriginal(true);
        }
        original.close();
      }
      bitmap.close();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [job.cutout, job.normalized]);

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

  const stampAt = useCallback(
    (x: number, y: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.save();
      if (tool === "restore" && originalRef.current) {
        // paint the original photo back in, full opacity
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(originalRef.current, 0, 0);
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    [tool, brushSize]
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
        stampAt(point.x, point.y);
      }
    },
    [ready, tool, tolerance, toCanvas, pushUndo, stampAt]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!strokingRef.current || tool === "wand") return;
      const point = toCanvas(e);
      if (point) stampAt(point.x, point.y);
    },
    [tool, toCanvas, stampAt]
  );

  const onPointerUp = useCallback(() => {
    strokingRef.current = false;
  }, []);

  const runOnImage = useCallback(
    (operation: (img: ImageData) => unknown) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) return;
      pushUndo();
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      operation(img);
      ctx.putImageData(img, 0, 0);
    },
    [pushUndo]
  );

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
              title="Trascina per cancellare a mano (−)"
            >
              🧽 Gomma −
            </button>
            <button
              type="button"
              className={tool === "restore" ? "selected" : ""}
              onClick={() => setTool("restore")}
              disabled={!hasOriginal}
              title="Trascina per ridipingere dall'originale (+): recupera parti rimosse per sbaglio o mangiate dal modello"
            >
              🖌 Ripristina +
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
          <button
            type="button"
            className="btn small"
            onClick={() => runOnImage(eraseSkin)}
            title="Rimuove in un colpo tutti i pixel color pelle rimasti (dita, mani, braccia)"
          >
            🖐 Rimuovi pelle
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => runOnImage(cleanEdges)}
            title="Ammorbidisce i bordi del ritaglio ed elimina gli aloni"
          >
            ✨ Pulisci bordi
          </button>
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
            Bacchetta: un clic rimuove la zona contigua di colore simile. Gomma −: cancella. Ripristina +:
            ridipinge dall&apos;originale (recupera parti rimosse per errore, anche dal modello). Rimuovi pelle:
            elimina dita e braccia residue in un colpo. L&apos;anteprima è già sul colore di sfondo scelto.
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
