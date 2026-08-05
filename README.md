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
