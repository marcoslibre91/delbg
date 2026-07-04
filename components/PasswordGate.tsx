"use client";

import { useCallback, useEffect, useState } from "react";
import type { ServerConfig } from "@/lib/types";
import { loadAppPassword, saveAppPassword } from "@/lib/settings";
import Processor from "./Processor";

async function fetchConfig(password: string): Promise<ServerConfig> {
  const headers: Record<string, string> = {};
  if (password) headers["x-app-password"] = password;
  const response = await fetch("/api/config", { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Configurazione non disponibile (${response.status})`);
  return (await response.json()) as ServerConfig;
}

export default function PasswordGate() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [checking, setChecking] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchConfig(loadAppPassword())
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {
        // config endpoint unreachable: fail open so local-only use keeps working
        if (!cancelled) {
          setConfig({ passwordRequired: false, authorized: true, serverKeys: null });
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const attempt = input.trim();
      if (!attempt) return;
      setSubmitting(true);
      setError(null);
      try {
        const cfg = await fetchConfig(attempt);
        if (cfg.authorized) {
          saveAppPassword(attempt);
          setConfig(cfg);
        } else {
          setError("Codice non corretto, riprova");
        }
      } catch {
        setError("Errore di rete, riprova");
      } finally {
        setSubmitting(false);
      }
    },
    [input]
  );

  if (checking) {
    return (
      <div className="gate">
        <div className="gate-card">
          <span className="spinner" aria-hidden /> Caricamento…
        </div>
      </div>
    );
  }

  if (config && config.passwordRequired && !config.authorized) {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={submit}>
          <h2>Accesso</h2>
          <p>Inserisci il codice di accesso per usare l&apos;app.</p>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={input}
            placeholder="Codice"
            onChange={(e) => setInput(e.target.value)}
            aria-label="Codice di accesso"
          />
          {error && <span className="field-error">{error}</span>}
          <button type="submit" className="btn primary" disabled={submitting || !input.trim()}>
            {submitting ? "Verifica…" : "Entra"}
          </button>
        </form>
      </div>
    );
  }

  return <Processor serverConfig={config} />;
}
