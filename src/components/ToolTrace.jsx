// Rende visibile il tool_calls trace che il backend restituisce già ad ogni
// turno ma che finora Desk scartava — stesso vocabolario ALLOW/DENY/
// REQUIRE_APPROVAL/CLIENT_ACTION di SecureAgentsFrontend/src/components/
// ToolCallTrace.jsx, per coerenza terminologica fra i due prodotti.
const DECISION_META = {
  ALLOW: { label: "Eseguito", className: "trace-allow" },
  DENY: { label: "Bloccato", className: "trace-deny" },
  REQUIRE_APPROVAL: { label: "Richiede approvazione Management", className: "trace-approval" },
  REQUIRE_SELF_APPROVAL: { label: "In attesa della tua conferma", className: "trace-self-approval" },
  CLIENT_ACTION: { label: "Eseguito in locale", className: "trace-client" },
};

const TOOL_LABELS = {
  search_local_files: "Ricerca Sicura Locale",
  read_local_file: "Consultazione File",
  list_local_directory: "Scansione Cartella",
  send_email: "Composizione Email",
  create_calendar_event: "Pianificazione Calendario",
  read_email_inbox: "Consultazione Posta",
  google_drive_search: "Ricerca Drive Condiviso",
  search_hr_documents: "Ricerca Policy HR",
  think: "Ragionamento in corso",
};

export default function ToolTrace({ toolCalls }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="tool-trace">
      {toolCalls.map((call, i) => {
        const meta = DECISION_META[call.decision] || { label: call.decision, className: "" };
        const toolLabel = TOOL_LABELS[call.tool_name] || call.tool_name;
        
        return (
          <div key={i} className={`trace-row ${meta.className}`}>
            <span className="trace-tool-name">
              {toolLabel}
            </span>
            <span className="trace-badge">{meta.label}</span>
            {call.decision === "DENY" && <span className="trace-reason">{call.reason}</span>}
            {call.tool_name === "think" && call.arguments?.rationale && (
              <div className="trace-thought" style={{color: "#888", fontStyle: "italic", marginLeft: "1rem", flexBasis: "100%"}}>
                🤔 {call.arguments.rationale}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
