# SecureAgents Desk

SecureAgents Desk è l'interfaccia utente (frontend) del sistema SecureAgents. È un'applicazione desktop leggera basata su Tauri (Vite + React), reattiva e orientata all'esperienza utente, costruita per rendere l'interazione con gli agenti sicura e trasparente.

## Stack Tecnologico
- **Framework Base**: Tauri (WebView OS-native / Rust)
- **Framework UI**: React
- **Build Tool**: Vite
- **Styling**: CSS (con variabili e classi personalizzate, implementazione Kimi-style per la UI)
- **Comunicazione**: Fetch API verso il backend FastAPI di SecureAgents, polling/stream.

## Caratteristiche Principali
1. **Composer UI Avanzato**: Barra di chat arrotondata, fluttuante, con supporto ad allegati (animazioni popover) e selettore integrato del modello AI / logica di reasoning.
2. **Goal Timeline**: Visualizzazione chiara dei `Goal` creati dall'agente, suddivisi per `PlanSteps`. L'utente può vedere cosa l'agente prevede di fare.
3. **Step Inspector e Tool Trace**: Modali/Sidebar per esplorare in dettaglio i parametri di input e output di ogni strumento usato, a fini di diagnostica e trasparenza.
4. **Pannello Approvazioni**: Flusso Human-in-the-Loop; l'interfaccia mostra schede di approvazione per permettere all'utente di autorizzare le azioni bloccanti dell'agente.
5. **Visualizzazione Artefatti**: Rendering integrato per PDF (pdf.js), documenti Markdown e risultati generati dall'agente.

## Sviluppo Locale
Assicurarsi di avere `node`, `npm` (o `yarn`), e `Rust` installati.

```bash
# 1. Installa le dipendenze
npm install

# 2. Avvia il server di sviluppo (Tauri)
npm run tauri dev
```
Il server girerà tipicamente su `http://localhost:5173` o aprirà una finestra desktop. È necessario che il `SecureAgentsBackend` sia in esecuzione (di default su porta `8000`) affinché le API rispondano correttamente.

## Limiti noti

**Dettatura vocale non disponibile nell'app desktop (Tauri/WKWebView).** Il pulsante di dettatura (`src/components/DictationButton.jsx`) è disattivato in modo esplicito e stabile quando l'app gira dentro Tauri, con un messaggio chiaro all'utente ("Usa il browser") — non è uno stato ambiguo, è una decisione deliberata.

Verificato empiricamente (build `.app` reale via `cargo tauri build --debug`, non `tauri dev`): `window.webkitSpeechRecognition` esiste nel WKWebView e `getUserMedia` (microfono) funziona correttamente, ma chiamare `SpeechRecognition.start()` fa crashare l'intero processo con `SIGABRT` (namespace TCC), anche con `NSMicrophoneUsageDescription`/`NSSpeechRecognitionUsageDescription` correttamente presenti in `Info.plist`. La causa non è una chiave Info.plist mancante (nonostante il messaggio del crash reporter): è che questa build è firmata ad-hoc (`codeSigningTeamID` vuoto) e TCC su macOS non concede l'accesso al servizio di riconoscimento vocale — a differenza del semplice microfono, più permissivo — a un binario privo di una firma Apple Developer ID reale.

Per abilitare la dettatura nativa in futuro servirebbe firmare e notarizzare l'app con un account Apple Developer reale: è una decisione di distribuzione/infrastruttura, non qualcosa che si possa risolvere lato codice in questo componente. Finché quella firma non esiste, disabilitare esplicitamente in Tauri (come oggi) è la scelta corretta — l'alternativa sarebbe un crash dell'intera app alla prima pressione del pulsante. La versione browser dell'app non ha questa limitazione: usa l'API Web Speech nativa del browser (Chrome/Edge/Safari 14.1+) senza alcun problema di code signing.
