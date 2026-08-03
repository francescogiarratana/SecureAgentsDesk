// Elenco delle chat passate — stesso ruolo della Sidebar del frontend web
// (SecureAgentsFrontend/src/components/Sidebar.jsx), con lo stesso confine di
// proprietà lato backend (session_id + ruolo simulato). Finché Desk non
// chiamava /conversations, chiudere l'app perdeva tutto lo storico.
export default function ConversationSidebar({
  conversations,
  activeConversationId,
  collapsed,
  onToggleCollapsed,
  onNewChat,
  onSelect,
  onDelete,
  disabled,
}) {
  if (collapsed) {
    return (
      <aside className="conversation-sidebar collapsed">
        <button
          type="button"
          className="sidebar-toggle"
          title="Mostra le chat"
          aria-label="Mostra le chat"
          onClick={onToggleCollapsed}
        >
          ☰
        </button>
      </aside>
    );
  }

  return (
    <aside className="conversation-sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-toggle"
          title="Nascondi le chat"
          aria-label="Nascondi le chat"
          onClick={onToggleCollapsed}
        >
          ☰
        </button>
        <button type="button" className="new-chat-button" onClick={onNewChat} disabled={disabled}>
          Nuova chat
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <p className="conversation-empty-hint">Nessuna chat salvata.</p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === activeConversationId ? "active" : ""}`}
            >
              <button
                type="button"
                className="conversation-item-open"
                onClick={() => onSelect(conv.id)}
                disabled={disabled}
                title={conv.title || "Nuova chat"}
              >
                {conv.title || "Nuova chat"}
              </button>
              <button
                type="button"
                className="conversation-item-delete"
                title="Elimina questa chat"
                aria-label="Elimina questa chat"
                onClick={() => onDelete(conv.id)}
                disabled={disabled}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
