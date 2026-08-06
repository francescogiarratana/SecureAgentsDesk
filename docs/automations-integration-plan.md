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

---

## 5. Decisione e raccomandazione (dopo aver riletto questo piano)

**AutomationPanel: procedere, con l'Opzione A+.** È un lavoro contenuto e a
basso rischio — tutti e tre gli endpoint REST che gli servono esistono e
funzionano già, il pattern di wiring in `App.jsx` è quello già usato 4-5
volte nel file (nessuna decisione architetturale nuova), e chiude un vuoto
UX reale e già esistente: oggi un'automazione si può creare da chat
(`create_automation`) ma non si può *vedere né gestire* da nessuna parte
dell'interfaccia — la funzionalità è "a metà" nel senso letterale, non
ipotetico. Scelgo A+ (spostare le fetch grezze in `src/api.js`) invece
della semplice A perché l'inconsistenza che risolve (URL di fallback
hardcoded, bypass della convenzione `request`/`getJson`/`postJson`) è
esattamente il tipo di piccola divergenza silenziosa che in questo progetto
si è deciso di correggere ogni volta che è stata trovata (vedi audit dei 5
tool), non qualcosa da lasciare "per dopo" con lo stesso lavoro già in
corso sullo stesso componente.

**EventReplay: NON procedere ora.** Non è indecisione — è una raccomandazione
esplicita di rimandare, per tre motivi concreti:

1. Il prerequisito backend è a due livelli (route mancante + emissione mai
   collegata), e il secondo livello richiede di toccare `_run_loop`,
   appena consolidato in questa stessa sessione proprio per *ridurre* il
   rischio su quella funzione. Aggiungere ora punti di emissione evento in
   più fasi del loop (chiamata LLM, tool call, decisione di policy, pausa/
   ripresa) va nella direzione opposta, prima che quella consolidazione
   abbia avuto un ciclo di verifica in produzione.
2. **Scoperta non ancora segnalata nel piano originale**: `EventReplay.jsx`
   accetta solo un `goalId`, e i Goal esistono solo in modalità "Con piano"
   (Guided) — nella modalità predefinita (Standard/Rapida) una
   conversazione non ha mai un Goal associato. Un EventReplay scopato per
   `goal_id` sarebbe quindi invisibile per la maggior parte delle
   conversazioni reali. `app/services/event_stream.py` espone anche
   `get_events_for_conversation` (oltre a `get_events_for_goal`), il che
   suggerisce che questo scoping alternativo fosse già previsto — ma è
   una decisione di design (per conversazione, non solo per goal) che va
   presa PRIMA di scrivere qualunque route, non durante l'implementazione.
3. Restano aperte decisioni di prodotto non tecniche che non è corretto
   prendere da solo: granularità dell'emissione (per ogni token? per ogni
   tool call? — incide sul costo per turno) e una politica di
   conservazione/pulizia per `agent_events` (stessa classe di problema già
   corretta per `store_memory` in questa sessione: senza un tetto, la
   tabella cresce senza limite).

Se in futuro si vuole riconsiderare, il punto 2 sopra è la prima domanda a
cui rispondere — cambia la forma stessa di qualunque piano successivo.

## 6. Piano di wiring — AutomationPanel (Opzione A+)

Solo piano: nessuna di queste modifiche è stata eseguita.

**`src/api.js`** — tre nuove funzioni, stesso pattern di `listConversations`/
`listArtifacts` (helper `request`/`getJson`/`postJson`, `BACKEND_URL` da
`VITE_BACKEND_URL`, mai un URL scritto a mano nel componente):
- `listAutomations(token)` → `GET /api/v1/automations`
- `deactivateAutomation(token, id)` → `DELETE /api/v1/automations/{id}`
- `activateAutomation(token, id)` → `POST /api/v1/automations/{id}/activate`

**`src/components/AutomationPanel.jsx`** — richiede una decisione a parte
per essere toccato (vincolo esplicito, non superato da questo piano):
sostituire le fetch dirette con le tre funzioni sopra; eliminare la prop
`baseUrl` e il fallback hardcoded (nessun altro componente in `App.jsx`
passa un `baseUrl` — l'unico stato di autenticazione già in scope è la
variabile `token`, `useState(null)` in `App.jsx:170`, passata a tutte le
altre chiamate API come primo argomento posizionale); aggiungere uno stato
vuoto visibile ("Nessuna automazione attiva") invece di `return null`.

**`App.jsx`**:
1. Nuovo `const [showAutomations, setShowAutomations] = useState(false)`,
   accanto agli state analoghi già presenti (`showArtifactsList`,
   `viewingArtifact`).
2. Un pulsante nell'header (stesso stile dei pulsanti esistenti per
   artifact/goal) che chiama `setShowAutomations(true)`.
3. Rendering condizionale — stesso pattern già usato per `viewingArtifact`/
   `ArtifactPanel` — di `<AutomationPanel token={token} onClose={() =>
   setShowAutomations(false)} />` come overlay/modale.
4. Punto da confermare con l'utente prima di implementare: overlay modale
   (consistente con `ArtifactPanel`) oppure pannello inline accanto a
   `ConversationSidebar` (anch'esso strutturalmente plausibile, primo
   figlio di `.app-layout`) — è una scelta di UX, non tecnica.

**Test necessari:**
- Backend: `tests/test_automations.py` (non esiste oggi) — lista/
  deactivate/activate con isolamento tenant/ruolo (stesso schema già usato
  per gli altri endpoint di questa sessione), 404 su id inesistente o di
  un altro tenant, idempotenza di activate/deactivate.
- Frontend: **prerequisito non banale** — il repo non ha alcun framework
  di test frontend oggi (`package.json` non ha script `test`, nessuna
  dipendenza Vitest/Jest/@testing-library, nessun file `*.test.jsx`
  esistente). Aggiungere test per `AutomationPanel.jsx` richiede prima
  introdurre un framework di test (Vitest è la scelta naturale con Vite
  già in uso) — una decisione di tooling a sé, non solo "aggiungere un
  test file", da confermare separatamente prima di impegnarsi sul resto di
  questo piano.
- End-to-end: verifica dal vivo (creare un'automazione da chat, confermarne
  la comparsa nel pannello, attivare/disattivare, confermare lo stato nello
  scheduler) — stesso stile già usato per le altre feature di questa
  sessione.

## 7. EventReplay — perché rimandato, e cosa servirebbe (solo se si cambia decisione)

Non un piano di implementazione — un contorno leggero, coerente con la
raccomandazione di rimandare in sezione 5. Se in futuro si decide
diversamente, prima di procedere andrebbero risolte in ordine:

1. **Scoping** (blocca tutto il resto): per `goal_id` o per
   `conversation_id`? Dato che i Goal esistono solo in modalità Guided,
   probabilmente `conversation_id` (per cui `get_events_for_conversation`
   esiste già) è la scelta più utile, ma è una decisione di prodotto, non
   tecnica.
2. **Granularità di emissione**: quali fasi del turno emettono un
   `AgentEvent` (tutte le otto già previste nello schema, o un
   sottoinsieme più economico), e con quale costo aggiuntivo per turno
   (una riga scritta in più per fase, moltiplicata per ogni iterazione del
   loop).
3. **Conservazione**: un tetto o una pulizia periodica su `agent_events`,
   decisa PRIMA che la tabella cresca, non dopo (stessa lezione già
   applicata a `store_memory` in questa sessione).
4. Solo dopo le tre decisioni sopra: route backend (`GET .../events`, con
   lo stesso isolamento tenant/ruolo degli altri endpoint), punti di
   emissione in `_run_loop`/`resume_agentic_turn`, wiring in
   `GoalTimeline.jsx` o altrove secondo lo scoping scelto al punto 1, e i
   test corrispondenti (route + emissione + eventuale UI).

## 8. Monitoraggio sessioni concorrenti

Osservato durante questo turno: il repo `SecureAgentsBackend` ha
`app/services/tool_handlers.py` modificato e non committato da una sessione
diversa dalla mia (stesso pattern già notato nel blocco precedente — lavoro
Gemini/Antigravity in corso in parallelo). Nessun conflitto con i file
toccati in questo blocco (nessuna modifica di codice qui, solo questo
documento). Continuo a scegliere i file da `git add` in modo esplicito
(mai `-A`/`-u`) per ridurre il rischio di finire dentro commit di un'altra
sessione, ma la finestra di rischio (due processi che fanno `git add`+
`git commit` sullo stesso index senza coordinamento) resta strutturale e
non elimino del tutto senza un accordo esplicito su chi/quando committa.
