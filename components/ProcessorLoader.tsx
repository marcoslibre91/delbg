"use client";

import dynamic from "next/dynamic";

// Client-only: Processor reads localStorage at first render, so it must
// never be server-rendered.
const Processor = dynamic(() => import("./Processor"), { ssr: false });

export default function ProcessorLoader() {
  return <Processor />;
}
