"use client";

import type { Provider, ServerConfig, Settings } from "@/lib/types";
import { COLOR_PRESETS, isValidHex } from "@/lib/settings";

const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: "local", label: "Locale (gratis)", hint: "Modello AI nel browser, nessun costo e nessun upload" },
  { id: "photoroom", label: "PhotoRoom", hint: "~$0,02 a immagine, qualità e-commerce" },
  { id: "removebg", label: "remove.bg", hint: "~$0,20 a immagine, per casi difficili" },
];

interface Props {
  settings: Settings;
  serverConfig: ServerConfig | null;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
}

export default function SettingsPanel({ settings, serverConfig, disabled, onChange }: Props) {
  const serverKeys = serverConfig?.serverKeys ?? { photoroom: false, removebg: false };
  const keyReady: Record<Provider, boolean> = {
    local: true,
    photoroom: serverKeys.photoroom || Boolean(settings.photoroomKey.trim()),
    removebg: serverKeys.removebg || Boolean(settings.removebgKey.trim()),
  };
  return (
    <section className="panel">
      <h2>Impostazioni</h2>

      <fieldset disabled={disabled}>
        <label className="field-label">Rimozione sfondo</label>
        <div className="provider-list">
          {PROVIDERS.map((p) => (
            <label key={p.id} className={`provider-option${settings.provider === p.id ? " selected" : ""}`}>
              <input
                type="radio"
                name="provider"
                checked={settings.provider === p.id}
                onChange={() => onChange({ provider: p.id })}
              />
              <span>
                <strong>
                  {p.label}
                  {p.id !== "local" && (
                    <span className={`key-badge${keyReady[p.id] ? " ready" : ""}`}>
                      {keyReady[p.id] ? "🔑 chiave attiva" : "chiave mancante"}
                    </span>
                  )}
                </strong>
                <small>{p.hint}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="bg-color">Colore sfondo</label>
          <div className="color-row">
            <input
              id="bg-color"
              type="color"
              value={isValidHex(settings.backgroundColor) ? settings.backgroundColor : "#F5F5F5"}
              onChange={(e) => onChange({ backgroundColor: e.target.value.toUpperCase() })}
            />
            <input
              className="hex-input"
              type="text"
              value={settings.backgroundColor}
              onChange={(e) => onChange({ backgroundColor: e.target.value.toUpperCase() })}
              spellCheck={false}
            />
            {COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`swatch${settings.backgroundColor === hex ? " selected" : ""}`}
                style={{ background: hex }}
                title={hex === "#F2EDE7" ? `${hex} — Colore cliente` : hex}
                onClick={() => onChange({ backgroundColor: hex })}
              />
            ))}
          </div>
          {!isValidHex(settings.backgroundColor) && (
            <small className="field-error">Formato HEX non valido (es. #F5F5F5)</small>
          )}
        </div>

        <div className="field">
          <label className="field-label">Formato output</label>
          <div className="segmented">
            <button
              type="button"
              className={settings.outputFormat === "original" ? "selected" : ""}
              onClick={() => onChange({ outputFormat: "original" })}
            >
              Originale
            </button>
            <button
              type="button"
              className={settings.outputFormat === "square" ? "selected" : ""}
              onClick={() => onChange({ outputFormat: "square" })}
            >
              Quadrato
            </button>
          </div>
          <small className="field-hint">
            {settings.outputFormat === "original"
              ? "Stesse dimensioni e inquadratura della foto: cambia solo lo sfondo."
              : "Canvas quadrato, soggetto centrato con margine."}
          </small>
        </div>

        {settings.outputFormat === "square" && (
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="square-size">Lato (px)</label>
              <input
                id="square-size"
                type="number"
                min={500}
                max={4472}
                step={1}
                value={settings.squareSize}
                onChange={(e) => onChange({ squareSize: Number(e.target.value) || 2000 })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="margin">Margine (%)</label>
              <input
                id="margin"
                type="number"
                min={0}
                max={30}
                step={1}
                value={settings.marginPercent}
                onChange={(e) => onChange({ marginPercent: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor="quality">
              Qualità JPG: {Math.round(settings.jpegQuality * 100)}
            </label>
            <input
              id="quality"
              type="range"
              min={80}
              max={100}
              step={1}
              value={Math.round(settings.jpegQuality * 100)}
              onChange={(e) => onChange({ jpegQuality: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="parallel">In parallelo</label>
            <input
              id="parallel"
              type="number"
              min={1}
              max={5}
              value={settings.parallelJobs}
              onChange={(e) =>
                onChange({ parallelJobs: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })
              }
            />
            <small className="field-hint">Solo per i provider API; il modello locale lavora in serie.</small>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
