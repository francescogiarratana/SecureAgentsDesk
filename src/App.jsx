import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import {
  deleteConversation,
  fetchToken,
  getArtifact,
  getConversation,
  listArtifacts,
  listConversations,
  reportArtifactSaved,
  sendChatMessage,
  submitClientActionResult,
  submitSelfApprovalResult,
} from "./api";
import ArtifactPanel from "./components/ArtifactPanel";
import ConversationSidebar from "./components/ConversationSidebar";
import PlanPreview from "./components/PlanPreview";
import SelfApprovalCard from "./components/SelfApprovalCard";
import ToolTrace from "./components/ToolTrace";
import {
  getAuthorizedFolder,
  pickAuthorizedFolder,
  runLocalToolAction,
  saveGeneratedBinaryFile,
  saveGeneratedFile,
} from "./localAgent";
import { generateReportPdfBase64, suggestedReportPdfFileName } from "./pdfRenderer";
import { buildReportMarkdown, suggestedReportFileName } from "./reportRenderer";
import "./App.css";

const ROLES = [
  { value: "IT", label: "Dipartimento IT" },
  { value: "HR", label: "Risorse Umane" },
  { value: "Management", label: "Management (Admin)" },
];

// Tre modalità, un solo dial di frizione — MAI una variante che tocchi il
// gate di approvazione umana sulle azioni WRITE (quello vive solo nel
// backend, in policy_engine.evaluate, e non dipende in alcun modo da questo
// valore): qui cambia solo quanto l'agente spiega in anticipo (Con piano) e
// quanto è silenzioso su letture/azioni locali già viste (Rapida).
const MODES = [
  { value: "guided", label: "Pianifica" },
  { value: "standard", label: "Passo-passo" },
  { value: "fast", label: "Rapida" },
];
const MODE_STORAGE_KEY = "secureagents-desk-mode";

// Persistita in locale come nel frontend RAG (stesso motivo: in assenza di
// un login reale per persona, è ciò che lega questo dispositivo a "un
// utente" agli occhi del backend — vedi Conversation in
// SecureAgentsBackend/app/models/domain.py).
const SESSION_ID_KEY = "secureagents-desk-session-id";

function getOrCreateSessionId() {
  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
}

function getStoredMode() {
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  return MODES.some((m) => m.value === stored) ? stored : "standard";
}

// Riporta un messaggio salvato (MessageOut dal backend) nella forma che usa
// la chat in memoria. Punto delicato: Message.artifact su DB contiene solo
// ciò che ha prodotto build_report_artifact ({title, summary, sections,
// charts}) — NON message_id né created_at, che invece vengono dalla riga del
// messaggio. Senza reiniettarli qui, riaprire una chat passata e premere
// "salva" romperebbe (reportArtifactSaved riceverebbe un message_id
// undefined, e il piè di pagina del report una data non valida).
function messageFromHistory(message) {
  return {
    role: message.role,
    content: message.content,
    toolCalls: message.tool_calls || undefined,
    artifact: message.artifact
      ? { ...message.artifact, message_id: message.id, created_at: message.created_at }
      : undefined,
  };
}

// Segue un turno finché non si conclude, eseguendo in locale ogni azione
// client richiesta dal backend nel frattempo — questo è il "trampolino"
// sincrono descritto in agent_loop.py: nessun WebSocket/SSE, solo una
// seconda POST per ogni pausa, dal punto di vista di chi la implementa qui.
//
// Risolve SOLO awaiting_client_action da sola. Né awaiting_plan_confirmation
// né awaiting_self_approval passano mai da qui: quegli stati li risolve un
// click umano (Conferma/Rifiuta in PlanPreview o SelfApprovalCard), non il
// client in automatico — confonderli disattiverebbe la modalità "Con piano"
// o, peggio, farebbe eseguire un'azione WRITE senza un vero consenso
// esplicito dell'utente.
async function runClientActionTrampoline(token, initialResponse, onToolRun) {
  let response = initialResponse;
  while (response.status === "awaiting_client_action") {
    const action = response.awaiting_client_action;
    onToolRun?.(action);
    const outcome = await runLocalToolAction(action.tool_name, action.tool_args);
    response = await submitClientActionResult(token, action.id, outcome);
  }
  return response;
}

export default function App() {
  const [role, setRole] = useState(null);
  const [token, setToken] = useState(null);
  const [authError, setAuthError] = useState(null);

  const [authorizedFolder, setAuthorizedFolder] = useState(null);
  const [sessionId] = useState(getOrCreateSessionId);
  const [mode, setMode] = useState(getStoredMode);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingNotice, setPendingNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Modalità "Con piano": il piano proposto aspetta un click umano prima
  // che qualunque tool esegua per davvero. pendingPlanQuery viene da
  // initialResponse.query (il backend la rimanda indietro identica),
  // non da uno stato separato scollegato dalla risposta che ha originato
  // il piano.
  const [pendingPlan, setPendingPlan] = useState(null);
  const [pendingPlanQuery, setPendingPlanQuery] = useState(null);

  // Self-approval: un'azione WRITE ordinaria (calendario/email propri)
  // aspetta un click umano — Conferma/Rifiuta in SelfApprovalCard — prima
  // di eseguire per davvero. Diverso dalla coda di approvazione Management
  // (quella vive in SecureAgentsFrontend, non qui): questa è la stessa
  // persona che ha avviato la conversazione, inline, nella stessa app.
  const [pendingSelfApproval, setPendingSelfApproval] = useState(null);

  // Rapida: un tool già notificato una volta in questa sessione non produce
  // più un avviso inline — solo una preferenza di UI, mai una scelta di
  // policy (il trace resta comunque nel messaggio finale via ToolTrace).
  const [seenToolNames, setSeenToolNames] = useState(() => new Set());

  const [savingArtifactAt, setSavingArtifactAt] = useState(null);
  const [showArtifactsList, setShowArtifactsList] = useState(false);
  const [pastArtifacts, setPastArtifacts] = useState([]);
  const [viewingArtifact, setViewingArtifact] = useState(null);

  // Chat passate (endpoint /conversations, già esistenti lato backend).
  const [conversations, setConversations] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    getAuthorizedFolder().then(setAuthorizedFolder).catch(() => setAuthorizedFolder(null));
  }, []);

  useEffect(() => {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (!token) return;
    // Best-effort: se l'elenco non si carica, la chat resta perfettamente
    // usabile — non vale un messaggio d'errore in faccia all'utente.
    listConversations(token, sessionId).then(setConversations).catch(() => {});
  }, [token, sessionId]);

  async function refreshConversations() {
    try {
      setConversations(await listConversations(token, sessionId));
    } catch {
      // vedi sopra: silenzioso di proposito
    }
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setPendingPlan(null);
    setPendingPlanQuery(null);
    setPendingSelfApproval(null);
    setPendingNotice(null);
    setError(null);
  }

  async function handleSelectConversation(id) {
    if (id === conversationId || sending) return;
    setError(null);
    try {
      const detail = await getConversation(token, sessionId, id);
      // Una chat riaperta non ha pause pendenti: quelle vivono solo dentro un
      // turno in corso e, se erano rimaste appese, sono comunque scadute
      // (vedi i TTL in agent_loop.py).
      setPendingPlan(null);
      setPendingPlanQuery(null);
      setPendingSelfApproval(null);
      setPendingNotice(null);
      setConversationId(detail.id);
      setMessages(detail.messages.map(messageFromHistory));
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function handleDeleteConversation(id) {
    if (!window.confirm("Eliminare questa chat? L'operazione non è reversibile.")) return;
    try {
      await deleteConversation(token, sessionId, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) startNewChat();
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  async function handleLogin(selectedRole) {
    setAuthError(null);
    try {
      const { access_token } = await fetchToken(selectedRole);
      setToken(access_token);
      setRole(selectedRole);
    } catch (err) {
      setAuthError(err.message);
    }
  }

  async function handleAuthorizeFolder() {
    try {
      const folder = await pickAuthorizedFolder();
      if (folder) {
        setAuthorizedFolder(folder);
      }
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  function handleToolRun(action) {
    const alreadySeen = seenToolNames.has(action.tool_name);
    setSeenToolNames((prev) => new Set(prev).add(action.tool_name));
    if (mode !== "fast" || !alreadySeen) {
      setPendingNotice(`Eseguo in locale: ${action.tool_name}...`);
    }
  }

  async function finishTurn(initialResponse) {
    setConversationId(initialResponse.conversation_id);
    // La conversazione (e il suo titolo, derivato dalla prima domanda) esiste
    // già lato server a questo punto, anche se il turno si mette in pausa:
    // l'elenco va aggiornato comunque, non solo sui turni conclusi.
    refreshConversations();

    if (initialResponse.status === "awaiting_plan_confirmation") {
      setPendingPlan(initialResponse.proposed_plan);
      // Il backend rimanda indietro la domanda originale identica in
      // .query — è la fonte di verità da riusare alla conferma/rifiuto,
      // non un testo tracciato separatamente lato client.
      setPendingPlanQuery(initialResponse.query);
      return;
    }

    if (initialResponse.status === "awaiting_self_approval") {
      setPendingSelfApproval(initialResponse.awaiting_self_approval);
      return;
    }

    const finalResponse = await runClientActionTrampoline(token, initialResponse, handleToolRun);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: finalResponse.response,
        toolCalls: finalResponse.tool_calls,
        artifact: finalResponse.artifact,
      },
    ]);
  }

  function handleComposerKeyDown(event) {
    // Invio da solo invia il messaggio (comportamento atteso di una chat);
    // Shift+Invio inserisce un vero a capo — comportamento nativo di una
    // textarea, che quindi qui va lasciato intatto (nessun preventDefault).
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    setPendingNotice(null);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuery("");

    try {
      const initial = await sendChatMessage(token, {
        query: trimmed,
        sessionId,
        conversationId,
        wantPlan: mode === "guided",
      });
      await finishTurn(initial);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setSending(false);
    }
  }

  async function handlePlanDecision(decision) {
    setPendingPlan(null);
    setSending(true);
    setError(null);
    try {
      const initial = await sendChatMessage(token, {
        query: pendingPlanQuery,
        sessionId,
        conversationId,
        planDecision: decision,
      });
      await finishTurn(initial);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setSending(false);
    }
  }

  async function handleSelfApprovalDecision(decision) {
    const selfApprovalId = pendingSelfApproval.id;
    setPendingSelfApproval(null);
    setSending(true);
    setError(null);
    try {
      const resumed = await submitSelfApprovalResult(token, selfApprovalId, decision);
      await finishTurn(resumed);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setSending(false);
    }
  }

  async function saveArtifactMarkdownToDisk(artifact) {
    const markdown = buildReportMarkdown(artifact);
    const savedPath = await saveGeneratedFile(suggestedReportFileName(artifact), markdown);
    if (savedPath) {
      // Best-effort: il file è già stato scritto sul disco dell'utente a
      // questo punto — un log di audit mancato non deve bloccare né
      // confondere l'utente con un errore su un salvataggio già riuscito.
      await reportArtifactSaved(token, sessionId, artifact.message_id, savedPath).catch(() => {});
    }
    return savedPath;
  }

  async function saveArtifactPdfToDisk(artifact, chartImages) {
    const base64 = await generateReportPdfBase64(artifact, chartImages);
    const savedPath = await saveGeneratedBinaryFile(suggestedReportPdfFileName(artifact), base64);
    if (savedPath) {
      await reportArtifactSaved(token, sessionId, artifact.message_id, savedPath).catch(() => {});
    }
    return savedPath;
  }

  // format è "markdown" o "pdf": stessa forma di stato/tracciamento per
  // entrambi, la sola differenza è quale funzione di salvataggio e quale
  // campo di messages/viewingArtifact aggiornare al termine.
  async function handleSaveArtifact(messageIndex, artifact, format, chartImages) {
    setSavingArtifactAt(`${messageIndex}:${format}`);
    try {
      const savedPath =
        format === "pdf"
          ? await saveArtifactPdfToDisk(artifact, chartImages)
          : await saveArtifactMarkdownToDisk(artifact);
      if (savedPath) {
        const pathField = format === "pdf" ? "savedPdfPath" : "savedMarkdownPath";
        setMessages((prev) =>
          prev.map((m, i) => (i === messageIndex ? { ...m, [pathField]: savedPath } : m))
        );
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSavingArtifactAt(null);
    }
  }

  async function handleSaveViewingArtifact(format, chartImages) {
    if (!viewingArtifact) return;
    setSavingArtifactAt(`viewing:${format}`);
    try {
      const savedPath =
        format === "pdf"
          ? await saveArtifactPdfToDisk(viewingArtifact, chartImages)
          : await saveArtifactMarkdownToDisk(viewingArtifact);
      if (savedPath) {
        const pathField = format === "pdf" ? "savedPdfPath" : "savedMarkdownPath";
        setViewingArtifact((prev) => (prev ? { ...prev, [pathField]: savedPath } : prev));
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSavingArtifactAt(null);
    }
  }

  async function handleToggleArtifactsList() {
    const next = !showArtifactsList;
    setShowArtifactsList(next);
    if (next) {
      try {
        setPastArtifacts(await listArtifacts(token, sessionId));
      } catch (err) {
        setError(String(err?.message || err));
      }
    }
  }

  async function handleViewPastArtifact(messageId) {
    try {
      setViewingArtifact(await getArtifact(token, sessionId, messageId));
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  if (!token) {
    return (
      <main className="login-screen">
        <h1>SecureAgents Desk</h1>
        <p>Il tuo agente personale, sul tuo computer.</p>
        <div className="role-picker">
          {ROLES.map((r) => (
            <button key={r.value} onClick={() => handleLogin(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        {authError && <p className="error-text">{authError}</p>}
      </main>
    );
  }

  return (
    <div className="app-layout">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
        onNewChat={startNewChat}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        disabled={sending}
      />

      <main className="app-shell">
      <header className="app-header">
        <div>
          <strong>SecureAgents Desk</strong>
          <span className="role-chip">{role}</span>
        </div>
        <div className="header-actions">
          <select
            className="mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            title="Modalità"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button onClick={handleAuthorizeFolder} className="folder-button">
            {authorizedFolder ? `Cartella: ${authorizedFolder}` : "Autorizza una cartella"}
          </button>
        </div>
      </header>

      <button onClick={handleToggleArtifactsList} className="artifacts-toggle-link">
        Documenti generati
      </button>

      {showArtifactsList && (
        <div className="artifacts-list">
          {pastArtifacts.length === 0 ? (
            <p className="artifacts-empty-hint">Nessun documento generato finora in questa sessione.</p>
          ) : (
            pastArtifacts.map((a) => (
              <button
                key={a.message_id}
                className="artifacts-list-item"
                onClick={() => handleViewPastArtifact(a.message_id)}
              >
                {a.title}
              </button>
            ))
          )}
        </div>
      )}

      {viewingArtifact && (
        <div className="modal-overlay" onClick={() => setViewingArtifact(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setViewingArtifact(null)}>
              Chiudi
            </button>
            <ArtifactPanel
              artifact={viewingArtifact}
              onSaveMarkdown={() => handleSaveViewingArtifact("markdown")}
              onSavePdf={(chartImages) => handleSaveViewingArtifact("pdf", chartImages)}
              savingFormat={
                savingArtifactAt === "viewing:markdown"
                  ? "markdown"
                  : savingArtifactAt === "viewing:pdf"
                    ? "pdf"
                    : null
              }
              savedMarkdownPath={viewingArtifact.savedMarkdownPath}
              savedPdfPath={viewingArtifact.savedPdfPath}
            />
          </div>
        </div>
      )}

      <section className="chat-log">
        {messages.length === 0 && (
          <p className="empty-hint">
            Chiedi qualcosa, ad esempio "cerca il file preventivo" (richiede una
            cartella autorizzata) o una domanda sulle policy aziendali.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.role === "assistant" && <ToolTrace toolCalls={m.toolCalls} />}
            {m.role === "assistant" ? (
              // Stesso trattamento di SecureAgentsFrontend (renderMessageContent
              // in Citation.jsx): il testo del modello è markdown vero (titoli,
              // grassetto, elenchi...), non una stringa da mostrare alla lettera
              // coi simboli #/** visibili. Solo l'assistente: un messaggio
              // utente resta testo semplice, non deve essere interpretato.
              <div className="message-text">
                <Markdown>{m.content}</Markdown>
              </div>
            ) : (
              m.content
            )}
            {m.artifact && (
              <ArtifactPanel
                artifact={m.artifact}
                onSaveMarkdown={() => handleSaveArtifact(i, m.artifact, "markdown")}
                onSavePdf={(chartImages) => handleSaveArtifact(i, m.artifact, "pdf", chartImages)}
                savingFormat={
                  savingArtifactAt === `${i}:markdown`
                    ? "markdown"
                    : savingArtifactAt === `${i}:pdf`
                      ? "pdf"
                      : null
                }
                savedMarkdownPath={m.savedMarkdownPath}
                savedPdfPath={m.savedPdfPath}
              />
            )}
          </div>
        ))}
        {pendingPlan && (
          <PlanPreview
            plan={pendingPlan}
            disabled={sending}
            onConfirm={() => handlePlanDecision("confirm")}
            onReject={() => handlePlanDecision("reject")}
          />
        )}
        {pendingSelfApproval && (
          <SelfApprovalCard
            selfApproval={pendingSelfApproval}
            disabled={sending}
            onConfirm={() => handleSelfApprovalDecision("confirm")}
            onReject={() => handleSelfApprovalDecision("reject")}
          />
        )}
        {pendingNotice && <div className="bubble bubble-system">{pendingNotice}</div>}
        {error && <div className="bubble bubble-error">{error}</div>}
      </section>

      <form className="composer" onSubmit={handleSend}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Scrivi un messaggio... (Shift+Invio per andare a capo)"
          disabled={sending || Boolean(pendingPlan) || Boolean(pendingSelfApproval)}
          rows={1}
        />
        <button
          type="submit"
          disabled={sending || Boolean(pendingPlan) || Boolean(pendingSelfApproval) || !query.trim()}
        >
          Invia
        </button>
      </form>
      </main>
    </div>
  );
}
