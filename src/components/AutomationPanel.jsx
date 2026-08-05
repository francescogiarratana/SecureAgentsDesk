import { useState, useEffect } from "react";

/**
 * Pannello delle automazioni ricorrenti nella sidebar del Desk.
 * Mostra le automazioni attive con toggle on/off e ultimo stato.
 */
export default function AutomationPanel({ token, baseUrl }) {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };
  const api = baseUrl || "http://127.0.0.1:8000";

  useEffect(() => {
    fetchAutomations();
  }, []);

  async function fetchAutomations() {
    try {
      const res = await fetch(`${api}/api/v1/automations`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch {
      /* silenzioso */
    } finally {
      setLoading(false);
    }
  }

  async function toggleAutomation(id, currentlyActive) {
    const endpoint = currentlyActive
      ? `${api}/api/v1/automations/${id}`
      : `${api}/api/v1/automations/${id}/activate`;
    const method = currentlyActive ? "DELETE" : "POST";

    try {
      const res = await fetch(endpoint, { method, headers });
      if (res.ok) fetchAutomations();
    } catch {
      /* silenzioso */
    }
  }

  function formatCron(expr) {
    const parts = expr.split(" ");
    if (parts.length !== 5) return expr;
    const [min, hour, , , dow] = parts;
    const days = dow === "*" ? "ogni giorno" : dow === "1-5" ? "lun-ven" : `giorno ${dow}`;
    return `${hour}:${min.padStart(2, "0")} ${days}`;
  }

  function formatDate(iso) {
    if (!iso) return "mai";
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) return <div className="automation-panel-loading">Caricamento…</div>;
  if (!automations.length) return null;

  return (
    <div className="automation-panel">
      <h3 className="automation-panel-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Automazioni
      </h3>
      <ul className="automation-list">
        {automations.map((a) => (
          <li key={a.id} className={`automation-item ${!a.is_active ? "inactive" : ""}`}>
            <div className="automation-item-header">
              <span className="automation-label">{a.label || a.prompt.slice(0, 40)}</span>
              <button
                className={`automation-toggle ${a.is_active ? "active" : ""}`}
                onClick={() => toggleAutomation(a.id, a.is_active)}
                title={a.is_active ? "Disattiva" : "Riattiva"}
              >
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </button>
            </div>
            <div className="automation-meta">
              <span className="automation-schedule">{formatCron(a.cron_expression)}</span>
              {a.last_run_at && (
                <span className={`automation-status ${a.last_status?.toLowerCase()}`}>
                  {a.last_status === "COMPLETED" ? "✓" : "✗"} {formatDate(a.last_run_at)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
