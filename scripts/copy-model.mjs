/**
 * Copies the IMG.LY background-removal model assets into public/imgly so the
 * in-browser provider works without the IMG.LY CDN (self-hosted mode).
 * Enable it by setting NEXT_PUBLIC_IMGLY_PATH=/imgly/ — without that env var
 * the app loads the assets from the CDN and this script is not needed.
 *
 * Usage: npm run model:selfhost
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@imgly", "background-removal-data", "dist");
const target = join(root, "public", "imgly");

if (!existsSync(source)) {
  console.error("Pacchetto dati non trovato: esegui prima `npm install`");
  process.exit(1);
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Modello copiato in ${target}`);
