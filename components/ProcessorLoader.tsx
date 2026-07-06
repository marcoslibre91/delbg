"use client";

import dynamic from "next/dynamic";

// Client-only: the gate and Processor read localStorage at first render,
// so they must never be server-rendered.
const PasswordGate = dynamic(() => import("./PasswordGate"), { ssr: false });

export default function ProcessorLoader() {
  return <PasswordGate />;
}
