import { useEffect, useState, useRef } from "react";
import Markdown from "react-markdown";
import {
  deleteConversation,
  fetchToken,
  getArtifact,
  getConversation,
  listArtifacts,
  listConversations,
  listGoals,
  cancelGoal,
  reportArtifactSaved,
  sendChatMessage,
  fetchDocumentBySource,
  submitClientActionResult,
  submitSelfApprovalResult,
  sendChatMessageStream,
  submitClientActionResultStream,
  submitSelfApprovalResultStream,
} from "./api";
import { renderMessageContent } from "./components/Citation";
import GoalTimeline from "./components/GoalTimeline";
import StepInspector from "./components/StepInspector";
import ArtifactPanel from "./components/ArtifactPanel";
import AttachMenu from "./components/AttachMenu";
import ModeMenu from "./components/ModeMenu";
import ModelMenu from "./components/ModelMenu";
import ConversationSidebar from "./components/ConversationSidebar";
import PlanPreview from "./components/PlanPreview";
import SelfApprovalCard from "./components/SelfApprovalCard";
import DictationButton from "./components/DictationButton";
import ToolTrace from "./components/ToolTrace";
import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  EditIcon,
  FileGenericIcon,
  ImageGenericIcon,
  XIcon,
} from "./components/ChatIcons";
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

const LLM_MODELS = [
  { value: "gpt-5.6-luna", label: "GPT-Luna" },
  { value: "gpt-5.6-sol", label: "GPT-Sol" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "o3-mini", label: "o3-mini" },
  { value: "o1", label: "o1" }
];
const REASONING_EFFORTS = [
  { value: "low", label: "Basso" },
  { value: "medium", label: "Medio" },
  { value: "high", label: "Alto" }
];

function modelSupportsReasoningEffort(modelValue) {
  return modelValue.startsWith("gpt-5") || modelValue.startsWith("o1") || modelValue.startsWith("o3");
}

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
    citations: message.citations || [],
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
async function runClientActionTrampoline(token, initialStream, onToolRun, onChunk) {
  let currentStream = initialStream;
  let finalResponse = null;

  while (currentStream) {
    let turnResult = null;
    for await (const chunk of currentStream) {
      if (onChunk) onChunk(chunk);
      if (chunk.type === "turn_end") {
        turnResult = chunk.result;
      }
    }

    if (!turnResult) {
      break;
    }

    if (turnResult.status === "awaiting_client_action") {
      const action = turnResult.awaiting_client_action;
      onToolRun?.(action);
      const outcome = await runLocalToolAction(action.tool_name, action.tool_args);
      currentStream = submitClientActionResultStream(token, action.id, outcome);
    } else {
      finalResponse = turnResult;
      currentStream = null;
    }
  }
  
  return finalResponse;
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
  const [loadingChats, setLoadingChats] = useState({});
  const activeConversationIdRef = useRef(conversationId);
  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);
  const sending = !!loadingChats[conversationId || 'new'];
  const [error, setError] = useState(null);
  const [activeGoal, setActiveGoal] = useState(null);
  const [inspectedStep, setInspectedStep] = useState(null);

  // Nuovi stati per UI avanzata
  const [model, setModel] = useState("gpt-5.6-luna");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [attachments, setAttachments] = useState([]);
  // Indice del messaggio appena copiato: solo per il feedback visivo
  // transitorio dell'icona (Copia -> Copiato), azzerato da solo dopo 1.5s.
  const [copiedIndex, setCopiedIndex] = useState(null);

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
  const [viewingCitationDoc, setViewingCitationDoc] = useState(null);

  async function handleOpenCitation(citation) {
    try {
      const data = await fetchDocumentBySource(token, sessionId, citation.source_ref);
      setViewingCitationDoc(data);
    } catch (err) {
      console.error("Errore recupero fonte:", err);
      setError(String(err?.message || err));
    }
  }

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
    setAttachments([]);
    setPendingSelfApproval(null);
    setPendingNotice(null);
    setError(null);
    setActiveGoal(null);
    setInspectedStep(null);
  }

  function handleCopyMessage(index, content) {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 1500);
      })
      .catch(() => {});
  }

  function handleEditQuestion(content) {
    setQuery(content);
  }

  async function handleFileAttachment(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            type: file.type.startsWith("image/") ? "image" : "document",
            data: ev.target.result,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = null; // reset input
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
      setActiveGoal(null);
      setInspectedStep(null);
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

  async function finishTurn(stream, targetChatId) {
    let currentAssistantMessage = { role: "assistant", content: "", toolCalls: [], citations: [], tempId: Date.now() };
    
    // Add the empty message to the UI if we are on the active conversation
    if (activeConversationIdRef.current === targetChatId || (targetChatId === 'new' && activeConversationIdRef.current === null)) {
      setMessages(prev => [...prev, currentAssistantMessage]);
    }

    const onChunk = (chunk) => {
      // Only update UI if this stream belongs to the active conversation
      const isActive = activeConversationIdRef.current === targetChatId || (targetChatId === 'new' && activeConversationIdRef.current === null) || (activeConversationIdRef.current === chunk.result?.conversation_id);
      
      if (chunk.type === "content_delta") {
        currentAssistantMessage.content += chunk.delta;
      } else if (chunk.type === "error") {
        throw new Error(chunk.detail || "Errore durante lo streaming dal server.");
      } else if (chunk.type === "turn_end" && chunk.result) {
        currentAssistantMessage.content = chunk.result.response || currentAssistantMessage.content;
        currentAssistantMessage.citations = chunk.result.citations || [];
        currentAssistantMessage.artifact = chunk.result.artifact;
        currentAssistantMessage.toolCalls = chunk.result.tool_calls || currentAssistantMessage.toolCalls;
        if (chunk.result.conversation_id && (targetChatId === 'new' && activeConversationIdRef.current === null)) {
          setConversationId(chunk.result.conversation_id);
          activeConversationIdRef.current = chunk.result.conversation_id;
        }
        refreshConversations();
      }
      // UI update
      if (isActive) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].tempId === currentAssistantMessage.tempId) {
              newMessages[lastIdx] = { ...currentAssistantMessage };
          } else {
              // fallback in case it was somehow removed or we are updating a different message
              newMessages.push({ ...currentAssistantMessage });
          }
          return newMessages;
        });
      }
    };

    try {
      const finalResponse = await runClientActionTrampoline(token, stream, handleToolRun, onChunk);
      
      if (finalResponse) {
        if (finalResponse.goal) setActiveGoal(finalResponse.goal);
        
        const newActiveId = finalResponse.conversation_id;
        if (targetChatId === 'new' && activeConversationIdRef.current === null) {
          setConversationId(newActiveId);
          activeConversationIdRef.current = newActiveId;
        }
        
        refreshConversations();

        if (finalResponse.status === "awaiting_plan_confirmation") {
          if (activeConversationIdRef.current === newActiveId) {
            setPendingPlan(finalResponse.proposed_plan);
            setPendingPlanQuery(finalResponse.query);
          }
          return;
        }

        if (finalResponse.status === "awaiting_self_approval") {
          if (activeConversationIdRef.current === newActiveId) {
            setPendingSelfApproval(finalResponse.awaiting_self_approval);
          }
          return;
        }
      }
    } catch (err) {
      if (!currentAssistantMessage.content) {
        setMessages(prev => prev.filter(m => m.tempId !== currentAssistantMessage.tempId));
      }
      throw err;
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || sending) return;

    const chatTargetId = conversationId || 'new';
    setLoadingChats(prev => ({ ...prev, [chatTargetId]: true }));
    setError(null);
    setPendingNotice(null);
    
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuery("");

    try {
      const stream = sendChatMessageStream(token, {
        query: trimmed,
        sessionId,
        conversationId,
        wantPlan: mode === "guided",
        model: model,
        reasoningEffort: (model.startsWith("gpt-5") || model.startsWith("o1") || model.startsWith("o3")) ? reasoningEffort : undefined,
        attachments: attachments,
      });
      setAttachments([]);
      await finishTurn(stream, chatTargetId);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setLoadingChats(prev => ({ ...prev, [chatTargetId]: false }));
    }
  }

  async function handlePlanDecision(decision) {
    setPendingPlan(null);
    const chatTargetId = conversationId;
    setLoadingChats(prev => ({ ...prev, [chatTargetId]: true }));
    setError(null);
    try {
      const stream = sendChatMessageStream(token, {
        query: pendingPlanQuery,
        sessionId,
        conversationId,
        planDecision: decision,
      });
      await finishTurn(stream, chatTargetId);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setLoadingChats(prev => ({ ...prev, [chatTargetId]: false }));
    }
  }

  async function handleSelfApprovalDecision(decision, approvedArgs = null) {
    const selfApprovalId = pendingSelfApproval.id;
    setPendingSelfApproval(null);
    const chatTargetId = conversationId;
    setLoadingChats(prev => ({ ...prev, [chatTargetId]: true }));
    setError(null);
    try {
      const stream = submitSelfApprovalResultStream(
        token,
        selfApprovalId,
        decision,
        approvedArgs
      );
      await finishTurn(stream, chatTargetId);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setLoadingChats(prev => ({ ...prev, [chatTargetId]: false }));
    }
  }

  const handleGoalCancel = async (goalId) => {
    try {
      await cancelGoal(token, goalId, sessionId);
      setActiveGoal(prev => prev && prev.id === goalId ? { ...prev, status: 'CANCELLED' } : prev);
    } catch (err) {
      console.error('Errore annullamento goal:', err);
    }
  };

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
        disabled={false}
      />

      <main className="app-shell">
      <header className="app-header">
        <div>
          <strong>SecureAgents Desk</strong>
          <span className="role-chip">{role}</span>
        </div>
        <div className="header-actions">
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
      {viewingCitationDoc && (
        <div className="modal-overlay" onClick={() => setViewingCitationDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setViewingCitationDoc(null)}>
              Chiudi
            </button>
            <div style={{ padding: '20px' }}>
              <h2 style={{ marginTop: 0 }}>{viewingCitationDoc.title}</h2>
              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px', maxHeight: '60vh', overflowY: 'auto' }}>
                {viewingCitationDoc.body}
              </div>
            </div>
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
            {m.role === "assistant" ? (
              <>
                <ToolTrace toolCalls={m.toolCalls} />
                <div className="message-text">
                  {!m.content ? (
                    <div className="typing-indicator">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  ) : (
                    renderMessageContent(m.content, m.citations, handleOpenCitation)
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <div className="citations-block">
                      <div className="citations-title">Fonti consultate</div>
                      <ul className="citation-list">
                        {m.citations.map((cit, idx) => (
                          <li key={idx}>
                            <button className="citation-btn" onClick={() => handleOpenCitation(cit)}>
                              <span className="citation-list-index">{cit.index}</span> {cit.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="message-actions">
                    <button
                      type="button"
                      className="message-action-btn"
                      onClick={() => handleCopyMessage(i, m.content)}
                      title="Copia"
                    >
                      {copiedIndex === i ? <CheckIcon size={14} /> : <CopyIcon />}
                      {copiedIndex === i ? "Copiato" : "Copia"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                {m.content}
                <div className="message-actions">
                  <button
                    type="button"
                    className="message-action-btn"
                    onClick={() => handleEditQuestion(m.content)}
                    title="Modifica"
                  >
                    <EditIcon />
                    Modifica
                  </button>
                </div>
              </div>
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
            disabled={false}
            onConfirm={() => handlePlanDecision("confirm")}
            onReject={() => handlePlanDecision("reject")}
          />
        )}
        {pendingSelfApproval && (
          <SelfApprovalCard
            selfApproval={pendingSelfApproval}
            disabled={false}
            onConfirm={(approvedArgs) => handleSelfApprovalDecision("confirm", approvedArgs)}
            onReject={() => handleSelfApprovalDecision("reject")}
          />
        )}
        {pendingNotice && <div className="bubble bubble-system">{pendingNotice}</div>}
        {error && <div className="bubble bubble-error">{error}</div>}
      </section>

      {activeGoal && (
        <GoalTimeline
          goal={activeGoal}
          onCancel={handleGoalCancel}
          onStepClick={(step) => setInspectedStep(step)}
        />
      )}

      <form className="composer" onSubmit={handleSend}>
        <div className="composer-surface">
          {attachments.length > 0 && (
            <div className="attachment-pills">
              {attachments.map((att, i) => (
                <div key={i} className="attachment-pill">
                  {att.type === "image" ? <ImageGenericIcon size={13} /> : <FileGenericIcon size={13} />}
                  <span className="attachment-pill-name">{att.name}</span>
                  <button
                    type="button"
                    className="attachment-pill-remove"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    title="Rimuovi allegato"
                    aria-label="Rimuovi allegato"
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="composer-textarea"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Scrivi un messaggio... (Shift+Invio per andare a capo)"
            disabled={sending || Boolean(pendingPlan) || Boolean(pendingSelfApproval)}
            rows={1}
          />
          <div className="composer-toolbar">
            <AttachMenu
              onFilesSelected={handleFileAttachment}
              disabled={sending || Boolean(pendingPlan) || Boolean(pendingSelfApproval)}
            />
            <div className="composer-toolbar-spacer" />
            <ModeMenu mode={mode} onModeChange={setMode} modes={MODES} disabled={false} />
            <ModelMenu
              model={model}
              onModelChange={setModel}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              models={LLM_MODELS}
              efforts={REASONING_EFFORTS}
              showEffort={modelSupportsReasoningEffort(model)}
              disabled={false}
            />
            <DictationButton
              onDictationResult={(transcript) =>
                setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript))
              }
              disabled={sending || Boolean(pendingPlan) || Boolean(pendingSelfApproval)}
            />
            <button
              type="submit"
              className="composer-send-button"
              disabled={
                sending ||
                Boolean(pendingPlan) ||
                Boolean(pendingSelfApproval) ||
                (!query.trim() && attachments.length === 0)
              }
              title="Invia"
              aria-label="Invia"
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>
      </form>
      </main>

      {inspectedStep && (
        <StepInspector
          step={inspectedStep}
          onClose={() => setInspectedStep(null)}
        />
      )}
    </div>
  );
}
