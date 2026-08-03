// Rende visibile il tool_calls trace che il backend restituisce già ad ogni
// turno ma che finora Desk scartava — stesso vocabolario ALLOW/DENY/
// REQUIRE_APPROVAL/CLIENT_ACTION di SecureAgentsFrontend/src/components/
// ToolCallTrace.jsx, per coerenza terminologica fra i due prodotti.
const DECISION_META = {
  ALLOW: { label: "Eseguito", className: "trace-allow" },
  DENY: { label: "Bloccato", className: "trace-deny" },
  REQUIRE_APPROVAL: { label: "Richiede approvazione Management", className: "trace-approval" },
  CLIENT_ACTION: { label: "Eseguito in locale", className: "trace-client" },
};

export default function ToolTrace({ toolCalls }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="tool-trace">
      {toolCalls.map((call, i) => {
        const meta = DECISION_META[call.decision] || { label: call.decision, className: "" };
        return (
          <div key={i} className={`trace-row ${meta.className}`}>
            <span className="trace-tool-name">{call.tool_name}</span>
            <span className="trace-badge">{meta.label}</span>
            {call.decision === "DENY" && <span className="trace-reason">{call.reason}</span>}
          </div>
        );
      })}
    </div>
  );
}
