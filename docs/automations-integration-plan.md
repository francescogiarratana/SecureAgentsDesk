# Piano: integrazione di AutomationPanel.jsx / EventReplay.jsx

Documento di sola pianificazione, prodotto su richiesta esplicita. **Nessuna
implementazione**: né questo lavoro né una futura esecuzione automatica di
questo piano devono modificare `AutomationPanel.jsx`, `EventReplay.jsx` o
`App.jsx` senza una decisione esplicita separata dell'utente.

## 1. Stato attuale

### `src/components/AutomationPanel.jsx` (104 righe)
- Componente completo e funzionante lato UI, ma **codice morto**: non
  importato da nessuna parte in `src/`, incluso `App.jsx` (nessun match per
  `AutomationPanel` fuori dalla propria dichiarazione).
- Fa fetch dirette (non usa `src/api.js`), con URL di base hardcoded come
  fallback (`http://127.0.0.1:8000`) invece di leggere `VITE_BACKEND_URL`
  come fa il resto dell'app.
- Endpoint backend che chiama — **tutti esistono e funzionano**:
  - `GET /api/v1/automations` (lista)
  - `DELETE /api/v1/automations/{id}` (disattiva)
  - `POST /api/v1/automations/{id}/activate` (riattiva)
- **Manca un endpoint REST di creazione**: oggi un'automazione si crea solo
  tramite il tool dell'agente (`create_automation`, invocato durante una
  conversazione) — il pannello non ha né può avere, allo stato attuale, un
  form "crea automazione", solo lista/toggle.
- Se la lista è vuota, il componente restituisce `null` (nessuno stato
  "nessuna automazione" visibile).

### `src/components/EventReplay.jsx` (125 righe)
- Anche questo completo lato UI, ma **codice morto**: stessa situazione,
  nessun riferimento fuori dalla propria dichiarazione.
- Chiama `GET /api/v1/goals/{goalId}/events` — **questa route non esiste
  nel backend**. Non è un problema di rete o di ambiente, è un buco reale
  nella API.
- Il modello dati sottostante esiste già ed è stato pensato esplicitamente
  per questo componente: `AgentEvent` (id, goal_id, conversation_id,
  step_id, event_type, data, timestamp) con i tipi di evento esatti che
  `EventReplay.jsx` sa visualizzare (LLM_REQUEST, LLM_RESPONSE, TOOL_CALL,
  TOOL_RESULT, POLICY_DECISION, APPROVAL_REQUESTED, APPROVAL_RESOLVED,
  ERROR), più gli schemi `AgentEventOut`/`AgentEventListOut` — il cui
  commento nel backend cita letteralmente "la EventReplay nel Desk" come
  consumatore previsto.
- **Il percorso di scrittura non è collegato**: `EventStream.emit()` (il
  writer) non viene mai chiamato da nessuna parte nel loop agentico oggi.
  Anche aggiungendo la sola route di lettura mancante, il risultato sarebbe
  sempre una lista vuota finché qualcosa non inizia davvero a emettere
  eventi durante l'esecuzione di un turno.

## 2. Opzioni di integrazione in App.jsx

`App.jsx` non ha un router né un `activeView` centralizzato: ogni
pannello/modale ha il proprio `useState` booleano indipendente (es.
`activeGoal`, `showArtifactsList`, `viewingArtifact`, `sidebarCollapsed`)
con un handler dedicato che lo attiva/disattiva. La sidebar delle chat
passate (`ConversationSidebar`) è il primo figlio di `.app-layout`, sibling
di `<main className="app-shell">`.

**Opzione A — Pannello "Automazioni" come nuovo stato indipendente**
Un nuovo `showAutomations` (useState) + un pulsante nell'header che lo
attiva, rendering condizionale di `<AutomationPanel token={...}
baseUrl={...} />` come overlay/modale — lo stesso pattern già usato 4-5
volte nel file (es. per `viewingArtifact`/`ArtifactPanel`). Sforzo
strutturale minimo. Non risolve la mancanza dell'endpoint di creazione né
tocca `EventReplay`.

**Opzione A+ — come sopra, ma prima si sposta la logica di fetch in `src/api.js`**
Stesso wiring di App.jsx, ma le fetch grezze di `AutomationPanel.jsx`
diventano nuove funzioni in `src/api.js` (`listAutomations`,
`toggleAutomation`, stesso pattern `request`/`getJson`/`postJson` già usato
da tutte le altre chiamate), invece di lasciare che il componente stesso
faccia fetch dirette con URL hardcoded. Corregge un'inconsistenza tecnica
reale (vedi Rischi), ma tocca `api.js` — file diverso da
`AutomationPanel.jsx` in senso stretto, ma da confermare con l'utente prima
di procedere, dato il vincolo "non toccare senza decisione".

**Opzione B — EventReplay agganciato a GoalTimeline**
`EventReplay.jsx` accetta un `goalId`: l'integrazione naturale è dentro
`GoalTimeline.jsx` (già renderizzato quando `activeGoal` è impostato), come
sezione espandibile "Mostra replay agente" per il goal attivo. Blocca su un
prerequisito backend non banale: va scritta da zero la route `GET
/api/v1/goals/{goal_id}/events`, e prima ancora va effettivamente collegata
l'emissione degli eventi (`EventStream.emit()`) dentro `_run_loop`/
`resume_agentic_turn` per ogni fase rilevante (chiamata LLM, tool call,
decisione di policy, richiesta/risoluzione di approvazione) — una modifica
al loop agentico appena consolidato in questa stessa sessione, da trattare
con la stessa cautela già usata per quella consolidazione.

**Opzione C — Nessuna integrazione ora, decisione esplicita**
Dato che sono codice morto da tempo non breve, un'alternativa legittima è
decidere esplicitamente di non integrarli in questo momento (eventualmente
rimuoverli, o lasciarli come riferimento per un lavoro futuro) invece di
un'integrazione parziale che lascerebbe `EventReplay` strutturalmente non
funzionante (zero eventi, sempre) finché il backend non è completato.

## 3. Rischi

- **EventReplay non è "quasi pronto": è bloccato su un prerequisito
  backend a due livelli** (route di lettura mancante + emissione mai
  collegata). Sottostimare questo può far sembrare l'integrazione un
  piccolo wiring frontend, quando richiede prima decisioni di design sul
  loop agentico (dove/cosa emettere, con quale costo per ogni turno).
- **AutomationPanel ha solo lista/toggle, non creazione**: se l'aspettativa
  è un form "crea automazione" nel pannello, serve anche un nuovo endpoint
  REST lato backend (oggi solo il tool dell'agente crea automazioni) — non
  solo wiring frontend.
- **Convenzione di fetch inconsistente**: entrambi i componenti bypassano
  `src/api.js` con fetch dirette e un URL di fallback hardcoded. Integrati
  as-is, introducono un secondo modo di parlare col backend nello stesso
  file — rischio di divergenza silenziosa se `VITE_BACKEND_URL` cambia e
  uno dei due continua a puntare al fallback.
- **Nessun test automatico esiste oggi** per nessuno dei due componenti
  frontend, né risultano test dedicati per gli endpoint REST automations
  lato backend.
- **Vincolo esplicito**: non toccare `AutomationPanel.jsx`/`EventReplay.jsx`
  senza una decisione a parte — questo documento non implica alcun via
  libera, resta da confermare quale opzione (se alcuna) perseguire.

## 4. Test necessari (se e quando si procede)

- Backend: test per gli endpoint REST `automations` esistenti (list/
  deactivate/activate) — isolamento tenant/ruolo, stati di errore.
- Backend (solo Opzione B): test per la nuova route `GET
  /api/v1/goals/{id}/events` (stesso isolamento tenant/ruolo degli altri
  endpoint) e per l'emissione effettiva degli eventi nel loop — assert che
  ogni fase rilevante di un turno produca la riga `AgentEvent` attesa.
- Frontend: test di rendering per entrambi i componenti (oggi zero) — lista
  vuota, lista popolata, toggle, stato di errore di rete.
- End-to-end: verifica dal vivo (stesso stile già usato per le altre
  feature di questa sessione) prima di considerare l'integrazione conclusa.
