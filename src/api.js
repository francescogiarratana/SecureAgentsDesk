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

async function postJson(path, token, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Richiesta fallita (${res.status})`);
  }
  return res.json();
}

export function sendChatMessage(token, { query, sessionId, conversationId }) {
  return postJson("/chat", token, {
    query,
    session_id: sessionId,
    conversation_id: conversationId ?? null,
  });
}

export function submitClientActionResult(token, clientActionId, { result, error }) {
  return postJson(`/chat/client-actions/${clientActionId}/result`, token, {
    result: result ?? null,
    error: error ?? null,
  });
}
