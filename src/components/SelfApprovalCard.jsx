// Conferma inline per un'azione WRITE ordinaria che riguarda solo l'utente
// stesso (create_calendar_event, send_email — approval_track="self" in
// agent_router.py): a differenza di un'azione a rischio più alto, qui non
// serve un ruolo Management separato in un'altra app — la stessa persona
// che ha avviato la conversazione conferma o rifiuta qui, prima che
// l'azione esegua per davvero (vedi submit_self_approval_result).
const TOOL_LABELS = {
  create_calendar_event: "Creare un evento sul calendario",
  send_email: "Inviare un'email",
};

function formatDetails(toolName, args) {
  if (!args) return "";
  if (toolName === "create_calendar_event") {
    return [
      args.title && `"${args.title}"`,
      args.start && args.end && `${args.start} → ${args.end}`,
      args.attendee_email && `con ${args.attendee_email}`,
    ]
      .filter(Boolean)
      .join(" — ");
  }
  if (toolName === "send_email") {
    return [args.recipient && `a ${args.recipient}`, args.subject && `oggetto "${args.subject}"`]
      .filter(Boolean)
      .join(" — ");
  }
  return JSON.stringify(args);
}

export default function SelfApprovalCard({ selfApproval, onConfirm, onReject, disabled }) {
  if (!selfApproval) return null;

  return (
    <div className="self-approval-card">
      <div className="self-approval-header">
        <strong>Conferma richiesta</strong>
        <span className="self-approval-note">
          Nessuna azione di questo tipo esegue mai senza il tuo consenso esplicito.
        </span>
      </div>
      <p className="self-approval-description">
        {TOOL_LABELS[selfApproval.tool_name] || selfApproval.tool_name}
      </p>
      <p className="self-approval-details">
        {formatDetails(selfApproval.tool_name, selfApproval.tool_args)}
      </p>
      <div className="self-approval-actions">
        <button type="button" onClick={onReject} disabled={disabled} className="plan-reject-button">
          Rifiuta
        </button>
        <button type="button" onClick={onConfirm} disabled={disabled}>
          Conferma
        </button>
      </div>
    </div>
  );
}
