import { useState, useEffect } from "react";

const EVENT_ICONS = {
  LLM_REQUEST: "🧠",
  LLM_RESPONSE: "💬",
  TOOL_CALL: "🔧",
  TOOL_RESULT: "📋",
  POLICY_DECISION: "🛡️",
  APPROVAL_REQUESTED: "⏳",
  APPROVAL_RESOLVED: "✅",
  ERROR: "⚠️",
};

const EVENT_LABELS = {
  LLM_REQUEST: "Richiesta al modello",
  LLM_RESPONSE: "Risposta del modello",
  TOOL_CALL: "Chiamata tool",
  TOOL_RESULT: "Risultato tool",
  POLICY_DECISION: "Decisione policy",
  APPROVAL_REQUESTED: "Approvazione richiesta",
  APPROVAL_RESOLVED: "Approvazione risolta",
  ERROR: "Errore",
};

/**
 * Timeline espandibile degli eventi granulari di un goal.
 * Mostra il replay completo del ragionamento dell'agente.
 */
export default function EventReplay({ goalId, token, baseUrl }) {
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState(new Set());
  const [loading, setLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };
  const api = baseUrl || "http://127.0.0.1:8000";

  async function loadEvents() {
    if (events.length > 0) {
      setExpanded(!expanded);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${api}/api/v1/goals/${goalId}/events`, { headers });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        setExpanded(true);
      }
    } catch {
      /* silenzioso */
    } finally {
      setLoading(false);
    }
  }

  function toggleEvent(eventId) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      next.has(eventId) ? next.delete(eventId) : next.add(eventId);
      return next;
    });
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function renderData(data) {
    if (!data) return null;
    return (
      <pre className="event-data">
        {JSON.stringify(data, null, 2).slice(0, 500)}
        {JSON.stringify(data, null, 2).length > 500 && "…"}
      </pre>
    );
  }

  return (
    <div className="event-replay">
      <button
        className="event-replay-toggle"
        onClick={loadEvents}
        disabled={loading}
      >
        {loading ? "Caricamento…" : expanded ? "▼ Nascondi replay" : "▶ Mostra replay agente"}
      </button>

      {expanded && events.length > 0 && (
        <div className="event-timeline">
          {events.map((evt) => (
            <div
              key={evt.id}
              className={`event-item event-type-${evt.event_type.toLowerCase()}`}
              onClick={() => toggleEvent(evt.id)}
            >
              <div className="event-header">
                <span className="event-icon">
                  {EVENT_ICONS[evt.event_type] || "•"}
                </span>
                <span className="event-label">
                  {EVENT_LABELS[evt.event_type] || evt.event_type}
                </span>
                <span className="event-time">{formatTime(evt.timestamp)}</span>
              </div>
              {expandedEvents.has(evt.id) && evt.data && (
                <div className="event-detail">{renderData(evt.data)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && events.length === 0 && !loading && (
        <p className="event-empty">Nessun evento registrato per questo goal.</p>
      )}
    </div>
  );
}
