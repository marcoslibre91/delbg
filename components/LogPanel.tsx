"use client";

import type { LogEntry } from "@/lib/types";

export default function LogPanel({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="panel log-panel">
      <h2>Log</h2>
      <ul>
        {entries.map((entry, i) => (
          <li key={`${entry.time}-${i}`} className={`log-${entry.level}`}>
            <span className="log-time">{entry.time}</span>
            <span>{entry.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
