// Anteprima del piano (modalità "Con piano") prima che il loop reattivo
// esegua qualunque tool per davvero — vedi app.services.agent_planner nel
// backend. Il piano è consultivo, non vincolante: i passi reali possono
// variare in base a cosa emerge durante l'esecuzione, come dice plan.note.
const RISK_LABELS = {
  read_only: "Lettura",
  client_action: "Locale, sul tuo computer",
  unknown: "Non disponibile",
};

// Per risk="write" la label dipende da CHI dovrà confermare (vedi
// PlanStepOut.approval_track): un'azione ordinaria come il proprio
// calendario/email la confermi tu stesso inline, non un ruolo Management
// separato — riservato solo alle azioni più delicate.
function writeStepLabel(step) {
  return step.approval_track === "management"
    ? "Scrittura — richiede approvazione Management"
    : "Scrittura — la confermi tu";
}

function stepRiskLabel(step) {
  if (step.risk === "write") return writeStepLabel(step);
  return RISK_LABELS[step.risk] || step.risk;
}

export default function PlanPreview({ plan, onConfirm, onReject, onRollback, disabled }) {
  if (!plan) return null;

  return (
    <div className="plan-preview">
      <div className="plan-preview-header">
        <strong>Piano proposto</strong>
        <span className="plan-goal">{plan.goal}</span>
      </div>

      {plan.steps.length === 0 ? (
        <p className="plan-empty-hint">
          Nessun passaggio specifico previsto: l'agente risponderebbe direttamente.
        </p>
      ) : (
        <ol className="plan-steps">
          {plan.steps.map((step) => (
            <li key={step.step_number} className={step.requires_approval ? "plan-step-approval" : ""}>
              <span className="plan-step-description">{step.description}</span>
              <span className="plan-step-risk">{stepRiskLabel(step)}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="plan-note">{plan.note}</p>

      <div className="plan-actions">
        <button type="button" onClick={onReject} disabled={disabled} className="plan-reject-button">
          Rifiuta
        </button>
        <button type="button" onClick={onConfirm} disabled={disabled}>
          Conferma ed esegui
        </button>
        {onRollback && (
          <button type="button" onClick={onRollback} disabled={disabled} style={{ background: '#ff3b30', color: 'white' }}>
            ⏪ Annulla modifiche (Time Machine)
          </button>
        )}
      </div>
    </div>
  );
}
