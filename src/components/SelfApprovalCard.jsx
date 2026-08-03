import { useState } from "react";

// Conferma inline per un'azione WRITE ordinaria che riguarda solo l'utente
// stesso (create_calendar_event, send_email — approval_track="self" in
// agent_router.py): a differenza di un'azione a rischio più alto, qui non
// serve un ruolo Management separato in un'altra app — la stessa persona
// che ha avviato la conversazione conferma o rifiuta qui, prima che
// l'azione esegua per davvero (vedi submit_self_approval_result).
//
// Mostra il contenuto INTEGRALE e lo rende modificabile. Non è una comodità:
// una versione precedente di questa card mostrava solo destinatario e oggetto
// di un'email, quindi l'utente confermava un testo che non aveva mai letto —
// il gate era formalmente presente e sostanzialmente cieco. Se un documento
// avvelenato ha influenzato il testo (prompt injection), è QUI che un umano
// se ne accorge, e ora può anche correggerlo prima dell'invio.
//
// I campi sono <input>/<textarea> con valore testuale puro, mai markdown o
// HTML renderizzato: il contenuto può derivare da una fonte non fidata e non
// deve poter essere interpretato dal browser.

const TOOL_LABELS = {
  create_calendar_event: "Creare un evento sul calendario",
  send_email: "Inviare un'email",
};

// Etichette in italiano per i campi degli schemi dei due tool self-approved
// (vedi parameters_schema in agent_router.py). Un campo non elencato viene
// comunque mostrato con la sua chiave grezza: meglio un'etichetta brutta che
// un campo invisibile che parte senza essere letto.
const FIELD_LABELS = {
  recipient: "Destinatario",
  subject: "Oggetto",
  body: "Testo del messaggio",
  title: "Titolo",
  start: "Inizio",
  end: "Fine",
  attendee_email: "Invitato",
};

// Quali campi meritano una textarea multi-riga invece di un input.
const LONG_TEXT_FIELDS = new Set(["body"]);

export default function SelfApprovalCard({ selfApproval, onConfirm, onReject, disabled }) {
  // Inizializzato una volta dalla proposta del modello; da qui in poi è
  // l'utente il proprietario di questi valori.
  const [args, setArgs] = useState(() => ({ ...(selfApproval?.tool_args || {}) }));

  if (!selfApproval) return null;

  const proposed = selfApproval.tool_args || {};
  const edited = Object.keys(args).some((k) => args[k] !== proposed[k]);

  function updateField(key, value) {
    setArgs((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="self-approval-card">
      <div className="self-approval-header">
        <strong>{TOOL_LABELS[selfApproval.tool_name] || selfApproval.tool_name}</strong>
        <span className="self-approval-note">
          Controlla il contenuto qui sotto: puoi correggerlo prima di confermare. Nulla viene
          eseguito senza il tuo consenso.
        </span>
      </div>

      <div className="self-approval-fields">
        {Object.entries(args).map(([key, value]) => (
          <label key={key} className="self-approval-field">
            <span className="self-approval-field-label">
              {FIELD_LABELS[key] || key}
              {value !== proposed[key] && (
                <span className="self-approval-field-edited"> — modificato</span>
              )}
            </span>
            {LONG_TEXT_FIELDS.has(key) ? (
              <textarea
                value={String(value ?? "")}
                onChange={(e) => updateField(key, e.target.value)}
                disabled={disabled}
                rows={6}
              />
            ) : (
              <input
                type="text"
                value={String(value ?? "")}
                onChange={(e) => updateField(key, e.target.value)}
                disabled={disabled}
              />
            )}
          </label>
        ))}
      </div>

      <div className="self-approval-actions">
        <button type="button" onClick={onReject} disabled={disabled} className="plan-reject-button">
          Rifiuta
        </button>
        <button type="button" onClick={() => onConfirm(args)} disabled={disabled}>
          {edited ? "Conferma le mie modifiche" : "Conferma"}
        </button>
      </div>
    </div>
  );
}
