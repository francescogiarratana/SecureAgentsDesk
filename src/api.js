// Stesso client "sottile" del frontend RAG (SecureAgentsFrontend/src/api/client.js):
// niente libreria HTTP aggiuntiva, solo fetch con l'header Authorization
// impostato a mano — qui in più c'è la logica per seguire un turno che si
// mette in pausa in attesa di un'azione locale (vedi runChatTurn).
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000/api/v1";

export async function fetchToken(role) {
  const res = await fetch(`${BACKEND_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    throw new Error(`Autenticazione fallita (${res.status})`);
  }
  return res.json();
}

async function request(method, path, token, { body, params } = {}) {
  const url = new URL(`${BACKEND_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || (res.status === 500 ? "Errore interno al server." : `Impossibile connettersi al server (${res.status}). Assicurati che il backend sia in esecuzione.`));
  }
  if (res.status === 204) return null;
  return res.json();
}

function postJson(path, token, body) {
  return request("POST", path, token, { body });
}

function getJson(path, token, params) {
  return request("GET", path, token, { params });
}

async function* postStream(path, token, body) {
  let res;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error("Errore di rete: impossibile raggiungere il server.");
  }
  if (!res || !res.ok) {
    const detail = res ? await res.json().catch(() => ({})) : {};
    const statusMsg = res ? (res.status === 404 ? "Endpoint non trovato (404)." : (res.status === 500 ? "Errore interno al server (500)." : `Richiesta fallita (${res.status}).`)) : "Risposta non valida dal server.";
    throw new Error(detail.detail || statusMsg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith("data: ")) {
        try {
          yield JSON.parse(trimmed.substring(6));
        } catch (e) {
          console.error("Error parsing SSE data", e);
        }
      }
    }
  }
  if (buffer) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data: ")) {
      try {
        yield JSON.parse(trimmed.substring(6));
      } catch (e) {
        console.error("Error parsing leftover SSE data", e);
      }
    }
  }
}

export function sendChatMessage(
  token,
  { query, sessionId, conversationId, wantPlan, planDecision, model, reasoningEffort, attachments }
) {
  return postJson("/chat", token, {
    query,
    session_id: sessionId,
    conversation_id: conversationId ?? null,
    want_plan: wantPlan ?? false,
    plan_decision: planDecision ?? null,
    model: model ?? null,
    reasoning_effort: reasoningEffort ?? null,
    attachments: attachments ?? [],
    template_override: "desk_assistant",
  });
}

export function sendChatMessageStream(
  token,
  { query, sessionId, conversationId, wantPlan, planDecision, model, reasoningEffort, attachments }
) {
  return postStream("/chat/stream", token, {
    query,
    session_id: sessionId,
    conversation_id: conversationId ?? null,
    want_plan: wantPlan ?? false,
    plan_decision: planDecision ?? null,
    model: model ?? null,
    reasoning_effort: reasoningEffort ?? null,
    attachments: attachments ?? [],
    template_override: "desk_assistant",
  });
}

export function submitClientActionResult(token, clientActionId, { result, error }) {
  return postJson(`/chat/client-actions/${clientActionId}/result`, token, {
    result: result ?? null,
    error: error ?? null,
  });
}

export async function* submitClientActionResultStream(token, clientActionId, { result, error }) {
  const res = await submitClientActionResult(token, clientActionId, { result, error });
  yield { type: "turn_end", result: res };
}

// Conferma/rifiuto della STESSA persona che ha avviato la conversazione per
// un'azione WRITE a rischio contenuto (calendario/email propri — vedi
// approval_track="self" in agent_router.py) — diverso dalla coda di
// approvazione Management, che vive in SecureAgentsFrontend, non qui.
// approvedArgs: il contenuto come l'utente lo ha effettivamente approvato,
// eventualmente corretto nella card. Il backend lo filtra alle sole chiavi
// dello schema del tool e lo ri-valida prima di eseguire (vedi
// policy_engine.sanitize_tool_arguments) — non è fidato solo perché arriva
// dalla nostra UI.
export function submitSelfApprovalResult(token, selfApprovalId, decision, approvedArgs = null) {
  return postJson(`/chat/self-approvals/${selfApprovalId}/result`, token, {
    decision,
    approved_args: approvedArgs,
  });
}

export async function* submitSelfApprovalResultStream(token, selfApprovalId, decision, approvedArgs = null) {
  const res = await submitSelfApprovalResult(token, selfApprovalId, decision, approvedArgs);
  yield { type: "turn_end", result: res };
}

// Le chat passate: endpoint già esistenti e testati lato backend (vedi
// app/api/v1/chat.py) che finora solo il frontend web usava — Desk le
// ignorava, perdendo tutto lo storico alla chiusura dell'app.
export function listConversations(token, sessionId) {
  return getJson("/conversations", token, { session_id: sessionId });
}

export function getConversation(token, sessionId, conversationId) {
  return getJson(`/conversations/${conversationId}`, token, { session_id: sessionId });
}

export function deleteConversation(token, sessionId, conversationId) {
  return request("DELETE", `/conversations/${conversationId}`, token, {
    params: { session_id: sessionId },
  });
}

export function listArtifacts(token, sessionId) {
  return getJson("/artifacts", token, { session_id: sessionId });
}

export function getArtifact(token, sessionId, messageId) {
  return getJson(`/artifacts/${messageId}`, token, { session_id: sessionId });
}

export function reportArtifactSaved(token, sessionId, messageId, savedPath) {
  return request("POST", `/artifacts/${messageId}/saved`, token, {
    params: { session_id: sessionId },
    body: { saved_path: savedPath },
  });
}

export function listGoals(token, conversationId, sessionId) {
  return getJson("/goals", token, { conversation_id: conversationId, session_id: sessionId });
}

export function getGoal(token, goalId, sessionId) {
  return getJson(`/goals/${goalId}`, token, { session_id: sessionId });
}

export function cancelGoal(token, goalId, sessionId) {
  return request("POST", `/goals/${goalId}/cancel`, token, { params: { session_id: sessionId } });
}

export function rollbackGoal(token, goalId, sessionId) {
  return request("POST", `/goals/${goalId}/rollback`, token, { params: { session_id: sessionId } });
}

export function fetchDocumentBySource(token, sessionId, sourceRef) {
  return getJson(`/documents/by-source/${encodeURIComponent(sourceRef)}`, token, { session_id: sessionId });
}

// Quali modelli il selettore può offrire — dipende da LLM_PROVIDER lato
// backend (una scelta di deployment), non un elenco fisso qui: con un
// deployment locale, i nomi OpenAI non significherebbero nulla per il
// server di inferenza configurato (vedi SecureAgentsBackend/app/api/v1/
// agent.py:get_available_models).
export function fetchAvailableModels(token) {
  return getJson("/agent/models", token);
}
