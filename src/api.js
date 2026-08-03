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
    throw new Error(detail.detail || `Richiesta fallita (${res.status})`);
  }
  return res.json();
}

function postJson(path, token, body) {
  return request("POST", path, token, { body });
}

function getJson(path, token, params) {
  return request("GET", path, token, { params });
}

export function sendChatMessage(
  token,
  { query, sessionId, conversationId, wantPlan, planDecision }
) {
  return postJson("/chat", token, {
    query,
    session_id: sessionId,
    conversation_id: conversationId ?? null,
    want_plan: wantPlan ?? false,
    plan_decision: planDecision ?? null,
  });
}

export function submitClientActionResult(token, clientActionId, { result, error }) {
  return postJson(`/chat/client-actions/${clientActionId}/result`, token, {
    result: result ?? null,
    error: error ?? null,
  });
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
