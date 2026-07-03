/**
 * Google Drive integration built on the Picker API + drive.file scope.
 * drive.file is a non-sensitive scope: no Google verification review needed,
 * and the app only ever sees files the user explicitly picks (plus files it
 * creates itself, e.g. the processed output).
 *
 * Requires two public env vars (see README):
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID  – OAuth client ID (Web application)
 *   NEXT_PUBLIC_GOOGLE_API_KEY    – API key for the Picker
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DrivePickedFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface DrivePickedFolder {
  id: string;
  name: string;
}

export function driveConfig(): { clientId: string; apiKey: string } | null {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  if (!clientId || !apiKey) return null;
  return { clientId, apiKey };
}

const loadedScripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = loadedScripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loadedScripts.delete(src);
      reject(new Error(`Impossibile caricare ${src}`));
    };
    document.head.appendChild(el);
  });
  loadedScripts.set(src, promise);
  return promise;
}

async function ensureGoogleLibs(): Promise<void> {
  await Promise.all([
    loadScript("https://apis.google.com/js/api.js"),
    loadScript("https://accounts.google.com/gsi/client"),
  ]);
  await new Promise<void>((resolve, reject) => {
    (window as any).gapi.load("picker", {
      callback: () => resolve(),
      onerror: () => reject(new Error("Caricamento Google Picker fallito")),
    });
  });
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Interactive on first call, then cached until ~1 minute before expiry. */
export async function getAccessToken(): Promise<string> {
  const config = driveConfig();
  if (!config) throw new Error("Google Drive non configurato");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  await ensureGoogleLibs();
  return new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(`Login Google fallito: ${response.error}`));
          return;
        }
        cachedToken = {
          value: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
        };
        resolve(response.access_token);
      },
      error_callback: (err: any) => {
        reject(new Error(`Login Google annullato o fallito: ${err?.type ?? "errore"}`));
      },
    });
    client.requestAccessToken();
  });
}

function openPicker(build: (picker: any, token: string, apiKey: string) => any): Promise<any[]> {
  return getAccessToken().then(
    (token) =>
      new Promise((resolve, reject) => {
        const config = driveConfig();
        if (!config) {
          reject(new Error("Google Drive non configurato"));
          return;
        }
        const google = (window as any).google;
        const builder = build(google.picker, token, config.apiKey).setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            resolve(data.docs ?? []);
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve([]);
          }
        });
        builder.build().setVisible(true);
      })
  );
}

/** Multi-select image picker with thumbnail grid, shared drives included. */
export async function pickImages(): Promise<DrivePickedFile[]> {
  const docs = await openPicker((picker, token, apiKey) => {
    const view = new picker.DocsView(picker.ViewId.DOCS_IMAGES)
      .setIncludeFolders(true)
      .setEnableDrives(true);
    return new picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setTitle("Seleziona le immagini da processare");
  });
  return docs.map((doc) => ({ id: doc.id, name: doc.name, mimeType: doc.mimeType }));
}

/** Folder picker for the output destination. */
export async function pickOutputFolder(): Promise<DrivePickedFolder | null> {
  const docs = await openPicker((picker, token, apiKey) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true);
    return new picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setTitle("Scegli la cartella di output su Drive");
  });
  if (!docs.length) return null;
  return { id: docs[0].id, name: docs[0].name };
}

export async function downloadDriveFile(file: DrivePickedFile): Promise<File> {
  const token = await getAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`Download di "${file.name}" fallito (${response.status})`);
  }
  const blob = await response.blob();
  return new File([blob], file.name, { type: file.mimeType || blob.type });
}

export async function uploadToDrive(blob: Blob, name: string, folderId: string): Promise<void> {
  const token = await getAccessToken();
  const metadata = { name, parents: [folderId], mimeType: "image/jpeg" };
  const body = new FormData();
  body.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  body.append("file", blob);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Upload di "${name}" fallito (${response.status}) ${text.slice(0, 200)}`);
  }
}
