"use client";

import { useCallback, useState } from "react";
import type { ServerConfig, Settings } from "@/lib/types";
import { loadAppPassword } from "@/lib/settings";

interface Props {
  settings: Settings;
  serverConfig: ServerConfig | null;
  disabled: boolean;
  onChange: (patch: Partial<Settings>) => void;
}

type KeyStatus = "server" | "browser" | "missing";

function statusFor(serverHasKey: boolean, browserKey: string): KeyStatus {
  if (serverHasKey) return "server";
  if (browserKey.trim()) return "browser";
  return "missing";
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  server: "Attiva sul server",
  browser: "Salvata in questo browser",
  missing: "Non configurata",
};

function StatusDot({ status }: { status: KeyStatus }) {
  return (
    <span className={`key-status key-${status}`}>
      <span className="key-dot" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

interface AccountInfo {
  credits: number;
  freeCalls: number;
}

export default function ApiKeysPanel({ settings, serverConfig, disabled, onChange }: Props) {
  const [showPhotoroom, setShowPhotoroom] = useState(false);
  const [showRemovebg, setShowRemovebg] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const serverKeys = serverConfig?.serverKeys ?? { photoroom: false, removebg: false };
  const photoroomStatus = statusFor(serverKeys.photoroom, settings.photoroomKey);
  const removebgStatus = statusFor(serverKeys.removebg, settings.removebgKey);
  const isSandbox = settings.photoroomKey.trim().toLowerCase().startsWith("sandbox_");

  const verifyRemovebg = useCallback(async () => {
    setVerifying(true);
    setAccount(null);
    setAccountError(null);
    try {
      const headers: Record<string, string> = {};
      const appPassword = loadAppPassword();
      if (appPassword) headers["x-app-password"] = appPassword;
      if (settings.removebgKey.trim()) headers["x-provider-key"] = settings.removebgKey.trim();
      const response = await fetch("/api/removebg-account", { headers, cache: "no-store" });
      const data = (await response.json()) as AccountInfo & { message?: string };
      if (!response.ok) {
        setAccountError(data.message ?? `Errore ${response.status}`);
      } else {
        setAccount({ credits: data.credits, freeCalls: data.freeCalls });
      }
    } catch {
      setAccountError("Errore di rete durante la verifica");
    } finally {
      setVerifying(false);
    }
  }, [settings.removebgKey]);

  return (
    <section className="panel">
      <h2>Chiavi API</h2>
      <fieldset disabled={disabled}>
        <div className="field">
          <div className="key-header">
            <label className="field-label" htmlFor="key-removebg">remove.bg</label>
            <StatusDot status={removebgStatus} />
          </div>
          {removebgStatus !== "server" && (
            <div className="key-row">
              <input
                id="key-removebg"
                type={showRemovebg ? "text" : "password"}
                value={settings.removebgKey}
                placeholder="Chiave API remove.bg"
                onChange={(e) => onChange({ removebgKey: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="mini-btn"
                title={showRemovebg ? "Nascondi" : "Mostra"}
                onClick={() => setShowRemovebg((v) => !v)}
              >
                {showRemovebg ? "🙈" : "👁"}
              </button>
            </div>
          )}
          {removebgStatus !== "missing" && (
            <div className="key-verify">
              <button type="button" className="btn small" onClick={() => void verifyRemovebg()} disabled={verifying}>
                {verifying ? "Verifica…" : "Verifica crediti"}
              </button>
              {account && (
                <span className="key-credits">
                  {account.credits} crediti · {account.freeCalls} chiamate preview gratuite
                </span>
              )}
              {accountError && <span className="field-error">{accountError}</span>}
            </div>
          )}
        </div>

        <div className="field">
          <div className="key-header">
            <label className="field-label" htmlFor="key-photoroom">PhotoRoom</label>
            <StatusDot status={photoroomStatus} />
          </div>
          {photoroomStatus !== "server" && (
            <div className="key-row">
              <input
                id="key-photoroom"
                type={showPhotoroom ? "text" : "password"}
                value={settings.photoroomKey}
                placeholder="sandbox_… o chiave live"
                onChange={(e) => onChange({ photoroomKey: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="mini-btn"
                title={showPhotoroom ? "Nascondi" : "Mostra"}
                onClick={() => setShowPhotoroom((v) => !v)}
              >
                {showPhotoroom ? "🙈" : "👁"}
              </button>
            </div>
          )}
          {isSandbox && (
            <small className="field-hint">
              Chiave <strong>sandbox</strong>: le chiamate sono gratuite ma i risultati hanno il watermark.
            </small>
          )}
        </div>

        <small className="field-hint">
          Le chiavi inserite qui restano salvate <strong>solo in questo browser</strong> e non vengono mai
          memorizzate sul server. Le chiavi configurate su Vercel (variabili d&apos;ambiente) valgono per tutti
          gli utenti dell&apos;app.
        </small>
      </fieldset>
    </section>
  );
}
