// Ponte fra i tool client-fulfilled decisi dal backend (vedi
// app.services.agent_router.ToolFulfillment.CLIENT in SecureAgentsBackend) e
// i comandi Rust che li eseguono davvero (src-tauri/src/lib.rs) — search e
// read restano scoperti finché l'utente non autorizza una cartella tramite
// pickAuthorizedFolder, mai l'intero filesystem.
import { invoke } from "@tauri-apps/api/core";

export function pickAuthorizedFolder() {
  return invoke("pick_authorized_folder");
}

export function getAuthorizedFolder() {
  return invoke("get_authorized_folder");
}

// Mappa 1:1 con i tool registrati come fulfilled_by=CLIENT nel backend
// (search_local_files, read_local_file): se il backend ne aggiunge uno
// nuovo, va aggiunto qui prima che questo client possa risolverlo.
const LOCAL_TOOL_HANDLERS = {
  search_local_files: (args) => invoke("search_local_files", { query: args.query }),
  read_local_file: (args) => invoke("read_local_file", { relativePath: args.relative_path }),
};

// Esegue localmente un'azione client richiesta dal backend, restituendo
// sempre {result} o {error} — mai un'eccezione non gestita: il turno remoto
// deve poter riprendere anche quando l'azione locale fallisce (permesso
// negato, cartella non più raggiungibile, tool sconosciuto), non restare
// bloccato in attesa di una risposta che non arriverà mai.
export async function runLocalToolAction(toolName, toolArgs) {
  const handler = LOCAL_TOOL_HANDLERS[toolName];
  if (!handler) {
    return { error: `Tool locale sconosciuto a questo client: ${toolName}` };
  }
  try {
    const result = await handler(toolArgs || {});
    return { result };
  } catch (err) {
    return { error: typeof err === "string" ? err : String(err?.message || err) };
  }
}
