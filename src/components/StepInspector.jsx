export default function StepInspector({ step, onClose }) {
  if (!step) return null;

  const statusConf = {
    PENDING: { icon: '⏳', label: 'In attesa' },
    IN_PROGRESS: { icon: '🔄', label: 'In corso' },
    COMPLETED: { icon: '✅', label: 'Completato' },
    FAILED: { icon: '❌', label: 'Fallito' },
    SKIPPED: { icon: '⏭️', label: 'Saltato' },
    AWAITING_APPROVAL: { icon: '⏸️', label: 'In approvazione' },
  };
  const conf = statusConf[step.status] || statusConf.PENDING;

  const formatTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('it-IT');
  };

  const formatJson = (obj) => {
    if (!obj) return null;
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  return (
    <div className="step-inspector-overlay" onClick={onClose}>
      <div className="step-inspector-panel" onClick={e => e.stopPropagation()}>
        <div className="step-inspector-header">
          <h3>
            <span className="step-inspector-icon">{conf.icon}</span>
            Passo {step.step_number}: {step.tool_name || 'Passo logico'}
          </h3>
          <button className="step-inspector-close" onClick={onClose}>✕</button>
        </div>

        <div className="step-inspector-body">
          <div className="inspector-section">
            <h4>Stato</h4>
            <span className={`inspector-status-badge step-${step.status?.toLowerCase()}`}>
              {conf.icon} {conf.label}
            </span>
          </div>

          {step.rationale && (
            <div className="inspector-section">
              <h4>Motivazione</h4>
              <p>{step.rationale}</p>
            </div>
          )}

          <div className="inspector-section inspector-meta-grid">
            <div className="inspector-meta-item">
              <label>Livello di rischio</label>
              <span className={`risk-badge-lg risk-${step.risk_level}`}>
                {step.risk_level === 'read_only' ? '🟢 Lettura' :
                 step.risk_level === 'write' ? '🟠 Scrittura' :
                 step.risk_level === 'client_action' ? '🔵 Locale' : '⚪ Sconosciuto'}
              </span>
            </div>
            {step.approval_track && (
              <div className="inspector-meta-item">
                <label>Approvazione</label>
                <span>{step.approval_track === 'self' ? '👤 Utente (self)' : '👥 Management'}</span>
              </div>
            )}
            <div className="inspector-meta-item">
              <label>Inizio</label>
              <span>{formatTime(step.started_at)}</span>
            </div>
            <div className="inspector-meta-item">
              <label>Fine</label>
              <span>{formatTime(step.completed_at)}</span>
            </div>
            {step.duration_ms != null && (
              <div className="inspector-meta-item">
                <label>Durata</label>
                <span>{step.duration_ms < 1000 ? `${step.duration_ms}ms` : `${(step.duration_ms / 1000).toFixed(1)}s`}</span>
              </div>
            )}
          </div>

          {step.input_args && (
            <div className="inspector-section">
              <h4>Parametri di input</h4>
              <pre className="inspector-json">{formatJson(step.input_args)}</pre>
            </div>
          )}

          {step.output_result && (
            <div className="inspector-section">
              <h4>Risultato</h4>
              <pre className="inspector-json">{formatJson(step.output_result)}</pre>
            </div>
          )}

          {step.error_message && (
            <div className="inspector-section inspector-error">
              <h4>⚠️ Errore</h4>
              <p className="error-text">{step.error_message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
