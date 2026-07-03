/** "IMG_0001.HEIC" → "IMG_0001_processed.jpg", with collision-safe suffixes. */
export function makeOutputNamer(): (originalName: string) => string {
  const used = new Set<string>();
  return (originalName: string) => {
    const base = originalName
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "immagine";
    let candidate = `${base}_processed.jpg`;
    let counter = 1;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}_processed_${counter}.jpg`;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
}
