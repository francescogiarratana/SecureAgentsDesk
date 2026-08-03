import { useEffect, useState } from "react";
import { fetchToken, sendChatMessage, submitClientActionResult } from "./api";
import { getAuthorizedFolder, pickAuthorizedFolder, runLocalToolAction } from "./localAgent";
import "./App.css";

const ROLES = [
  { value: "IT", label: "Dipartimento IT" },
  { value: "HR", label: "Risorse Umane" },
  { value: "Management", label: "Management (Admin)" },
];

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

// Segue un turno finché non si conclude, eseguendo in locale ogni azione
// client richiesta dal backend nel frattempo — questo è il "trampolino"
// sincrono descritto in agent_loop.py: nessun WebSocket/SSE, solo una
// seconda POST per ogni pausa, dal punto di vista di chi la implementa qui.
async function runChatTurnToCompletion(token, chatCall, onToolRun) {
  let response = await chatCall();
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
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingNotice, setPendingNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAuthorizedFolder().then(setAuthorizedFolder).catch(() => setAuthorizedFolder(null));
  }, []);

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
      const finalResponse = await runChatTurnToCompletion(
        token,
        () => sendChatMessage(token, { query: trimmed, sessionId, conversationId }),
        (action) => setPendingNotice(`Eseguo in locale: ${action.tool_name}...`),
      );
      setConversationId(finalResponse.conversation_id);
      setMessages((prev) => [...prev, { role: "assistant", content: finalResponse.response }]);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPendingNotice(null);
      setSending(false);
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
    <main className="app-shell">
      <header className="app-header">
        <div>
          <strong>SecureAgents Desk</strong>
          <span className="role-chip">{role}</span>
        </div>
        <button onClick={handleAuthorizeFolder} className="folder-button">
          {authorizedFolder ? `Cartella: ${authorizedFolder}` : "Autorizza una cartella"}
        </button>
      </header>

      <section className="chat-log">
        {messages.length === 0 && (
          <p className="empty-hint">
            Chiedi qualcosa, ad esempio "cerca il file preventivo" (richiede una
            cartella autorizzata) o una domanda sulle policy aziendali.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.content}
          </div>
        ))}
        {pendingNotice && <div className="bubble bubble-system">{pendingNotice}</div>}
        {error && <div className="bubble bubble-error">{error}</div>}
      </section>

      <form className="composer" onSubmit={handleSend}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Scrivi un messaggio..."
          disabled={sending}
        />
        <button type="submit" disabled={sending || !query.trim()}>
          Invia
        </button>
      </form>
    </main>
  );
}
