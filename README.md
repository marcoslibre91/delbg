# Shopify Image Processor

Web app per il processing batch di foto prodotto e-commerce: rimozione dello sfondo e applicazione di uno sfondo uniforme (colore HEX configurabile), con export JPG pronto per Shopify.

- **Sorgenti**: file locali (drag & drop) o selezione diretta da **Google Drive** (galleria con miniature, selezione multipla, Drive condivisi)
- **Formati supportati**: HEIC, JPG/JPEG, PNG, WEBP (con orientamento EXIF corretto)
- **Rimozione sfondo**, a scelta:
  - **Locale (gratis)** — modello AI che gira nel browser, nessun costo e nessun upload a terzi
  - **PhotoRoom** (~$0,02/immagine) — qualità e-commerce
  - **remove.bg** (~$0,20/immagine) — per i casi difficili
- **Output**: JPG qualità 92, formato **originale** (stessa inquadratura, cambia solo lo sfondo) oppure **quadrato** con soggetto centrato e margine configurabile
- **Consegna**: download ZIP oppure upload diretto in una cartella di Google Drive
- Batch con parallelismo, retry automatico, skip delle immagini fallite, log live e **cache degli scontorni** (ri-processare con un altro colore non ripaga mai l'API)
- **Retry per singola immagine** (icona ↻ sulla card): riprova solo quella foto con la variante alternativa del modello locale oppure con PhotoRoom/remove.bg, senza toccare le altre — utile quando il modello gratuito include mani o braccia che tengono il prodotto
- **"Riapplica colore/formato a tutte"**: ricompone tutte le immagini dagli scontorni già fatti (zero chiamate API, istantaneo) per provare più colori di sfondo

## Avvio rapido

```bash
npm install
npm run dev        # http://localhost:3000
```

Funziona subito senza alcuna configurazione: carichi i file dal computer e usi il provider locale gratuito. Google Drive e i provider API si attivano con le variabili d'ambiente qui sotto.

## Configurazione (`.env.local` o variabili Vercel)

Copia `.env.example` in `.env.local` e compila ciò che ti serve. Tutto è opzionale.

| Variabile | A cosa serve |
|---|---|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | OAuth client ID per il Google Picker |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | API key per il Google Picker |
| `PHOTOROOM_API_KEY` | Chiave PhotoRoom lato server (in alternativa si incolla nella UI) |
| `REMOVEBG_API_KEY` | Chiave remove.bg lato server (in alternativa si incolla nella UI) |
| `NEXT_PUBLIC_IMGLY_PATH` | Percorso alternativo per gli asset del modello locale (default: self-hosted `/imgly/`) |

Le chiavi incollate nella UI restano nel `localStorage` del browser e transitano dal proxy `/api/segment` senza mai essere salvate sul server. Le chiavi configurate come variabili d'ambiente non raggiungono mai il browser.

## Setup Google Cloud (per l'integrazione Drive)

Circa 5 minuti, una tantum:

1. Vai su [console.cloud.google.com](https://console.cloud.google.com) e crea un nuovo progetto.
2. **API e servizi → Libreria**: abilita **Google Drive API** e **Google Picker API**.
3. **API e servizi → Schermata consenso OAuth**: tipo *Esterno*, compila nome app ed email. Non servono scope aggiuntivi né verifica: l'app usa solo lo scope `drive.file` (non sensibile — vede solo i file che l'utente seleziona e quelli che crea).
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**: tipo *Applicazione web*. In "Origini JavaScript autorizzate" aggiungi `http://localhost:3000` e l'URL di produzione (es. `https://tuaapp.vercel.app`). Copia il client ID in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
5. **Crea credenziali → Chiave API**: copiala in `NEXT_PUBLIC_GOOGLE_API_KEY` (puoi restringerla alle due API abilitate e ai tuoi domini).
6. Finché la schermata consenso è in modalità *Testing*, aggiungi in **Utenti di test** gli account Google che useranno l'app (il tuo e quello del cliente).

## Deploy su Vercel

1. Importa il repository su [vercel.com](https://vercel.com) (framework: Next.js, nessuna configurazione particolare).
2. Aggiungi le variabili d'ambiente desiderate (vedi tabella sopra).
3. Aggiungi il dominio di produzione alle "Origini JavaScript autorizzate" del client OAuth (punto 4 del setup).

Gli asset del modello locale (~210 MB) vengono copiati in `public/imgly/` automaticamente a ogni build (`prebuild` → `scripts/copy-model.mjs`), quindi l'app non dipende da CDN esterni.

Nota: il proxy `/api/segment` limita le immagini a ~4 MB (limite piattaforma Vercel). L'app ridimensiona automaticamente le foto lato client (max 4096 px, JPEG) prima dell'invio, quindi il limite non si incontra nell'uso normale.

## Architettura

Quasi tutto avviene **nel browser** — il server fa solo da custode delle chiavi API:

```
Drive/file locale → normalizzazione (HEIC→JPEG, EXIF, resize)
                  → scontorno PNG con alpha (locale | PhotoRoom | remove.bg via /api/segment)
                  → compositing locale su canvas (colore HEX, formato originale o quadrato)
                  → export JPG q92 → ZIP o upload su Drive
```

Il compositing è sempre locale: l'output è identico al pixel qualunque provider si usi.

```
app/
  page.tsx, layout.tsx        UI shell
  api/segment/route.ts        proxy PhotoRoom / remove.bg (chiavi mai nel browser)
components/
  Processor.tsx               stato batch, sorgenti, output
  SettingsPanel.tsx           provider, colore, formato, qualità
  JobCard.tsx, LogPanel.tsx
lib/
  pipeline/normalize.ts       HEIC, EXIF, resize per upload
  pipeline/providers.ts       astrazione provider → PNG con alpha
  pipeline/composite.ts       sfondo HEX, bbox soggetto, export JPG
  pipeline/batch.ts           pool parallelo, retry/backoff, errori fatali
  pipeline/naming.ts          nome_processed.jpg anti-collisione
  drive/google.ts             Picker (scope drive.file), download, upload
scripts/copy-model.mjs        self-hosting asset modello locale
```

### Gestione errori API

- `401/402/403` (chiave non valida / crediti finiti) → **batch interrotto** subito: nessuna chiamata sprecata
- `429` (rate limit) → retry rispettando `Retry-After`
- `5xx` / errori di rete → fino a 3 tentativi con backoff (2s, 4s, 8s)
- altri `4xx` (es. soggetto non riconosciuto) → immagine saltata, il batch continua
- Gli scontorni riusciti sono in cache: rilanciare il batch (o cambiare colore) non genera nuove chiamate a pagamento
