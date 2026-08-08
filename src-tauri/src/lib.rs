use std::fs;
use std::path::{Path, PathBuf};

use calamine::Reader;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

// Nessun comando qui sotto ha bisogno di una voce nelle capabilities
// (src-tauri/capabilities/default.json): quel sistema regola i comandi
// esposti da un plugin all'invoke() del webview, non i comandi definiti
// dall'app stessa tramite invoke_handler. Il plugin dialog è usato solo
// internamente da pick_authorized_folder (mai invocato direttamente da JS),
// quindi non serve concedergli alcun permesso lato webview.

const CONFIG_FILE_NAME: &str = "authorized_folder.json";
const MAX_SEARCH_RESULTS: usize = 50;
const MAX_SEARCH_DEPTH: usize = 8;
const MAX_READABLE_BYTES: u64 = 200_000;
// Cap separato per i formati che possono finire nel percorso NeedsOcr (PDF,
// immagini): MAX_READABLE_BYTES è tarato per "quanto testo entra in un
// turno di chat", non per "quanti byte grezzi può avere una foto o una
// scansione reale". Una foto da telefono è tipicamente 2-8MB, una pagina
// scansionata a 200dpi anche 1-3MB — entrambe ben sopra 200_000 byte, quindi
// riusare lo stesso cap qui avrebbe rifiutato la maggior parte degli input
// reali per cui questo percorso esiste (trovato in revisione: i soli test
// che passavano usavano fixture sintetiche di poche decine di byte).
// 15MB lascia margine sotto MAX_UPLOAD_FILE_BYTES del backend (20MB, vedi
// app/api/v1/documents.py) — i byte inviati al backend sono quelli
// originali (JS decodifica il base64 prima di ri-caricarli), non la
// stringa base64 inflazionata che viaggia solo sull'IPC locale di Tauri.
const MAX_OCR_SOURCE_BYTES: u64 = 15_000_000;
// Cap sul testo DOPO l'estrazione, non solo sui byte grezzi sopra: un XLSX
// è uno zip, il rapporto fra dimensione su disco e testo estratto non è
// affidabile, quindi il cap sui byte grezzi da solo non basta a limitare
// quanto testo finisce nel prompt del modello.
const MAX_EXTRACTED_TEXT_CHARS: usize = 200_000;
const MAX_SPREADSHEET_SHEETS: usize = 20;
const MAX_SPREADSHEET_ROWS_PER_SHEET: usize = 2_000;

#[derive(serde::Serialize, serde::Deserialize)]
struct AuthorizedFolderConfig {
    path: String,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Impossibile risolvere la cartella di configurazione: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Impossibile creare la cartella di configurazione: {e}"))?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

fn read_authorized_root(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = config_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: AuthorizedFolderConfig =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(PathBuf::from(config.path)))
}

fn write_authorized_root(app: &AppHandle, root: &Path) -> Result<(), String> {
    let path = config_file_path(app)?;
    let config = AuthorizedFolderConfig {
        path: root.to_string_lossy().into_owned(),
    };
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

fn require_authorized_root(app: &AppHandle) -> Result<PathBuf, String> {
    read_authorized_root(app)?.ok_or_else(|| {
        "Nessuna cartella autorizzata: scegline una prima di cercare o leggere file.".to_string()
    })
}

/// Verifica che `candidate` sia davvero contenuto in `root`, risolvendo
/// entrambi con canonicalize() (segue anche i symlink) prima del confronto:
/// un confronto puramente testuale sui path non basterebbe a impedire né un
/// "../" nel percorso relativo né un symlink dentro la cartella autorizzata
/// che punti fuori da essa.
fn ensure_within_root(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Cartella autorizzata non più raggiungibile.".to_string())?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| "Percorso non trovato.".to_string())?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err("Percorso fuori dalla cartella autorizzata.".to_string());
    }
    Ok(canonical_candidate)
}

#[tauri::command]
async fn pick_authorized_folder(app: AppHandle) -> Result<Option<String>, String> {
    // Deliberatamente NON blocking_pick_folder(): quella chiamata blocca il
    // thread chiamante in attesa che il pannello nativo (NSOpenPanel su
    // macOS) risponda, ma il pannello va comunque creato sul thread
    // principale — se il comando gira già sul thread principale, resta in
    // stallo per sempre (il pannello non appare mai, la rotella gira
    // all'infinito). La variante a callback invece schedula il pannello sul
    // thread principale e torna subito; qui il risultato arriva tramite un
    // oneshot channel su cui questo comando async può fare .await senza
    // bloccare nessun thread.
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let selected = rx
        .await
        .map_err(|_| "Selettore cartella chiuso senza risposta.".to_string())?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("Percorso cartella non valido: {e}"))?;
    write_authorized_root(&app, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Mostra il selettore di salvataggio nativo e risolve nel percorso scelto
/// (None se l'utente annulla) — condiviso da save_generated_file e
/// save_generated_binary_file, che differiscono solo in COSA scrivono una
/// volta ottenuto il percorso (testo vs byte binari decodificati).
///
/// Stesso pattern (oneshot + DialogExt, mai blocking_*) di
/// pick_authorized_folder, con save_file() al posto di pick_folder().
/// Deliberatamente NESSUN ensure_within_root qui: a differenza di
/// search_local_files/read_local_file (l'agente che legge dentro una
/// cartella già autorizzata), questo è un salvataggio scelto e confermato
/// dall'utente stesso tramite il selettore nativo del sistema operativo —
/// lo stesso confine di fiducia già accettato per pick_authorized_folder,
/// non l'agente che scrive a un percorso arbitrario di sua scelta.
async fn prompt_save_file_path(
    app: &AppHandle,
    suggested_file_name: &str,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(suggested_file_name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let selected = rx
        .await
        .map_err(|_| "Selettore di salvataggio chiuso senza risposta.".to_string())?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("Percorso di salvataggio non valido: {e}"))?;
    Ok(Some(path))
}

/// Isolata dal comando Tauri per essere testabile senza il selettore nativo
/// (vedi i test in fondo al file): un base64 non valido deve tornare un
/// errore chiaro, non un panic o byte silenziosamente sbagliati su disco.
fn decode_base64_content(content_base64: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD
        .decode(content_base64)
        .map_err(|e| format!("Contenuto base64 non valido: {e}"))
}

/// Simmetrica a decode_base64_content sopra — usata dal lato NeedsOcr di
/// read_local_file per incapsulare byte grezzi (PDF scansionato o immagine)
/// in un formato che sopravvive l'IPC di Tauri verso JS.
fn encode_base64_content(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(bytes)
}

#[tauri::command]
async fn save_generated_file(
    app: AppHandle,
    suggested_file_name: String,
    content: String,
) -> Result<Option<String>, String> {
    // Agnostico rispetto al formato testuale (oggi markdown) — scrive
    // semplicemente `content` così com'è dov'è l'utente a scegliere. Per
    // contenuto binario (es. un PDF esportato) vedi save_generated_binary_file
    // sotto: un valore Stringa JS non può portare byte binari arbitrari senza
    // corrompersi, va incapsulato in base64 invece.
    let Some(path) = prompt_save_file_path(&app, &suggested_file_name).await? else {
        return Ok(None);
    };
    fs::write(&path, content).map_err(|e| format!("Impossibile scrivere il file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_generated_binary_file(
    app: AppHandle,
    suggested_file_name: String,
    content_base64: String,
) -> Result<Option<String>, String> {
    // Stesso comando/pattern di save_generated_file, ma per contenuto
    // binario (oggi: un report esportato come PDF) — vedi decode_base64_content.
    let Some(path) = prompt_save_file_path(&app, &suggested_file_name).await? else {
        return Ok(None);
    };
    let bytes = decode_base64_content(&content_base64)?;
    fs::write(&path, bytes).map_err(|e| format!("Impossibile scrivere il file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn get_authorized_folder(app: AppHandle) -> Result<Option<String>, String> {
    Ok(read_authorized_root(&app)?.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn search_local_files(app: AppHandle, query: String) -> Result<Vec<String>, String> {
    let root = require_authorized_root(&app)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Cartella autorizzata non più raggiungibile.".to_string())?;
    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();
    walk_and_match(&canonical_root, &canonical_root, &query_lower, 0, &mut matches);
    Ok(matches)
}

/// Confronto minimale in stile glob: '*' vale "zero o più caratteri
/// qualunque", il resto è letterale (niente '?', niente classi tipo
/// '[abc]' — non serve, vedi sotto). Senza '*' ricade nel semplice "il testo
/// contiene il pattern", cioè il comportamento originale di questa funzione.
///
/// Il motivo per cui questo esiste: il modello, quando gli si chiede "ci
/// sono file .docx?", tende naturalmente a interrogare search_local_files
/// con query="*.docx" — un'aspettativa ragionevole di chi ha usato una
/// shell, ma un pattern letterale come "*.docx" non compare mai in un nome
/// di file reale, quindi un semplice contains() restituisce sempre zero
/// risultati. Rendere il tool tollerante ai glob è più robusto che sperare
/// che il prompt disciplini il modello a scrivere solo "docx".
fn glob_match(pattern: &str, text: &str) -> bool {
    let segments: Vec<&str> = pattern.split('*').collect();
    if segments.len() == 1 {
        return text.contains(pattern);
    }

    let mut pos = 0usize;
    for (i, segment) in segments.iter().enumerate() {
        if segment.is_empty() {
            continue;
        }
        if i == 0 {
            if !text[pos..].starts_with(segment) {
                return false;
            }
            pos += segment.len();
        } else if i == segments.len() - 1 {
            return text[pos..].ends_with(segment);
        } else {
            match text[pos..].find(segment) {
                Some(found) => pos += found + segment.len(),
                None => return false,
            }
        }
    }
    true
}

/// Cammina l'albero sotto `dir` (mai fuori da `root`, perché non segue mai
/// entry al di fuori di ciò che read_dir restituisce per una directory già
/// nota essere dentro root) cercando file il cui nome corrisponde a
/// `query_lower` secondo glob_match. Profondità e numero di risultati sono
/// limitati: una cartella aziendale autorizzata può contenere decine di
/// migliaia di file, e questa è una ricerca interattiva dentro un turno di
/// chat, non un'indicizzazione.
fn walk_and_match(
    root: &Path,
    dir: &Path,
    query_lower: &str,
    depth: usize,
    matches: &mut Vec<String>,
) {
    if depth > MAX_SEARCH_DEPTH || matches.len() >= MAX_SEARCH_RESULTS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if matches.len() >= MAX_SEARCH_RESULTS {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // File e cartelle nascoste (che iniziano con '.') sono escluse: quasi
        // sempre metadati (.git, .DS_Store), mai ciò che un utente intende
        // quando chiede di "cercare un file".
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk_and_match(root, &path, query_lower, depth + 1, matches);
        } else if glob_match(query_lower, &name.to_lowercase()) {
            if let Ok(relative) = path.strip_prefix(root) {
                matches.push(relative.to_string_lossy().into_owned());
            }
        }
    }
}

/// Esito di read_local_file verso JS. Due varianti perché Rust non fa mai
/// OCR: quando il testo non è nativamente estraibile (PDF scansionato) o il
/// file è direttamente un'immagine, la lettura non fallisce — restituisce i
/// byte grezzi in base64 così JS può delegare l'estrazione al backend
/// (POST /api/v1/documents/extract-text). Serializzato con
/// `#[serde(tag = "kind")]`: verso JS arriva come
/// `{"kind": "Text", "content": "..."}` oppure
/// `{"kind": "NeedsOcr", "content_base64": "...", "filename": "..."}` — le
/// chiavi sono un contratto già fissato con un lavoro JS parallelo, non
/// vanno rinominate.
#[derive(serde::Serialize, Debug)]
#[serde(tag = "kind")]
enum ReadFileResult {
    Text { content: String },
    NeedsOcr { content_base64: String, filename: String },
}

/// Legge i byte grezzi di un file già validato (dentro la cartella
/// autorizzata, sotto il cap di dimensione) e li incapsula in
/// ReadFileResult::NeedsOcr — condiviso dal ramo immagine (mai testo, non ci
/// si prova nemmeno) e dal ramo PDF scansionato (testo nativo assente o
/// troppo corto per essere affidabile). In entrambi i casi Rust non tenta
/// l'OCR: si limita a passare i byte al chiamante JS.
fn needs_ocr_result(canonical: &Path) -> Result<ReadFileResult, String> {
    let bytes = fs::read(canonical).map_err(|e| format!("Impossibile leggere il file: {e}"))?;
    let filename = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ReadFileResult::NeedsOcr {
        content_base64: encode_base64_content(&bytes),
        filename,
    })
}

/// Quale cap di dimensione si applica a un'estensione — isolata da
/// read_local_file per essere testabile senza un AppHandle reale: pdf e
/// immagini possono finire nel percorso NeedsOcr (byte grezzi delegati al
/// backend), che tollera file molto più grandi di quanto MAX_READABLE_BYTES
/// permetta (vedi il commento su MAX_OCR_SOURCE_BYTES sopra) — per tutto il
/// resto (testo semplice, XLSX) questo comando serve solo a passare un
/// estratto al modello dentro un turno di chat, quindi resta il cap più
/// stretto.
fn size_limit_for_extension(extension: &str) -> u64 {
    if matches!(extension, "pdf" | "jpg" | "jpeg" | "png") {
        MAX_OCR_SOURCE_BYTES
    } else {
        MAX_READABLE_BYTES
    }
}

#[tauri::command]
fn read_local_file(app: AppHandle, relative_path: String) -> Result<ReadFileResult, String> {
    let root = require_authorized_root(&app)?;
    let candidate = root.join(&relative_path);
    let canonical = ensure_within_root(&root, &candidate)?;

    let extension = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();

    // Limite di dimensione, controllato una volta sola qui prima di
    // qualunque dispatch per estensione — ma NON identico per tutti i rami,
    // vedi size_limit_for_extension.
    let size_limit = size_limit_for_extension(&extension);
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > size_limit {
        return Err(format!(
            "Il file supera il limite di {size_limit} byte leggibili."
        ));
    }

    extract_file_content(&canonical, &extension)
}

/// Cuore di read_local_file, isolato dal comando Tauri per essere testabile
/// senza un AppHandle reale (vedi i test in fondo al file): riceve un
/// percorso già validato e la sua estensione già in minuscolo, e decide come
/// estrarne il contenuto.
fn extract_file_content(canonical: &Path, extension: &str) -> Result<ReadFileResult, String> {
    let result = match extension {
        "docx" => ReadFileResult::Text {
            content: extract_docx_text(canonical)?,
        },
        "pdf" => match extract_pdf_text(canonical)? {
            PdfExtraction::Text(text) => ReadFileResult::Text { content: text },
            PdfExtraction::ScannedNeedsOcr => needs_ocr_result(canonical)?,
        },
        "xlsx" | "xlsm" | "xls" | "ods" => ReadFileResult::Text {
            content: extract_spreadsheet_text(canonical)?,
        },
        // Non gestito affatto prima: cadeva nel ramo `_` sotto e falliva con
        // l'errore generico "non è testo leggibile". Rust non tenta mai di
        // leggere un'immagine come testo: i byte grezzi vanno sempre
        // delegati al chiamante JS via NeedsOcr.
        "jpg" | "jpeg" | "png" => needs_ocr_result(canonical)?,
        // Qualunque altra estensione (.txt, .md, ...) segue il percorso
        // originale invariato: solo PDF, DOCX e fogli di calcolo hanno
        // bisogno di un'estrazione vera, il resto è già testo.
        _ => ReadFileResult::Text {
            content: fs::read_to_string(canonical).map_err(|_| {
                "Il file non è testo leggibile (probabilmente binario).".to_string()
            })?,
        },
    };

    // Il troncamento si applica solo al caso Text: il base64 di NeedsOcr ha
    // già il suo controllo di dimensione a monte via MAX_READABLE_BYTES
    // (sui byte grezzi su disco, verificato in read_local_file sopra).
    Ok(match result {
        ReadFileResult::Text { content } => ReadFileResult::Text {
            content: truncate_with_notice(content, MAX_EXTRACTED_TEXT_CHARS),
        },
        needs_ocr @ ReadFileResult::NeedsOcr { .. } => needs_ocr,
    })
}

/// Non tronca mai in silenzio: se il testo estratto supera il cap, lo dice
/// esplicitamente invece di limitarsi a tagliarlo (stesso principio già
/// applicato al cap sui risultati di ricerca).
fn truncate_with_notice(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text;
    }
    let truncated: String = text.chars().take(max_chars).collect();
    format!("{truncated}\n\n[Contenuto troncato a {max_chars} caratteri]")
}

/// Esito dell'estrazione testo da un PDF: un PDF fatto solo di pagine
/// scansionate come immagini non ha testo nativo, ma non è un errore — è un
/// caso distinto che il chiamante (extract_file_content) deve poter
/// trasformare in ReadFileResult::NeedsOcr invece che propagare come Err.
#[derive(Debug)]
enum PdfExtraction {
    Text(String),
    ScannedNeedsOcr,
}

/// Estrae il testo da un PDF. Avvolto in catch_unwind perché un parser
/// puro-Rust su un input binario avversariale (un PDF malformato o
/// deliberatamente corrotto) è una fonte classica di panic — un file messo
/// male non deve poter far morire l'intera app.
fn extract_pdf_text(path: &Path) -> Result<PdfExtraction, String> {
    let owned_path = path.to_path_buf();
    let outcome = std::panic::catch_unwind(move || pdf_extract::extract_text(&owned_path));

    let text = match outcome {
        Ok(Ok(text)) => text,
        Ok(Err(_)) => {
            // pdf-extract non distingue in modo affidabile "protetto da
            // password" da "danneggiato" — un messaggio unificato è più
            // onesto di una falsa precisione che il crate non garantisce.
            // Questo resta un Err vero: a differenza del caso sotto, non è
            // qualcosa che l'OCR lato backend potrebbe risolvere.
            return Err(
                "Impossibile leggere questo PDF: potrebbe essere protetto da password o \
                 danneggiato."
                    .to_string(),
            );
        }
        Err(_) => return Err("Errore interno durante l'analisi del PDF.".to_string()),
    };

    if text.trim().chars().count() < 20 {
        // Non un errore: è il caso, distinto, di un PDF fatto solo di
        // pagine scansionate come immagini — il chiamante lo trasforma in
        // ReadFileResult::NeedsOcr, delegando l'estrazione al backend.
        return Ok(PdfExtraction::ScannedNeedsOcr);
    }
    Ok(PdfExtraction::Text(text))
}

/// Estrae il testo da un .docx: paragrafi e celle di tabella (una riga per
/// riga di tabella, celle separate da tab — stesso stile tabulare di
/// extract_spreadsheet_text sotto). Avvolto in catch_unwind per lo stesso
/// motivo di extract_pdf_text: un parser puro-Rust su un file corrotto o non
/// realmente un .docx non deve poter panicare.
fn extract_docx_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Impossibile leggere il file: {e}"))?;
    let outcome = std::panic::catch_unwind(move || docx_rs::read_docx(&bytes));

    let docx = match outcome {
        Ok(Ok(docx)) => docx,
        Ok(Err(_)) => {
            return Err("Il file non sembra un .docx valido o è danneggiato.".to_string());
        }
        Err(_) => {
            return Err("Errore interno durante l'analisi del documento .docx.".to_string());
        }
    };

    let mut output = String::new();
    for child in &docx.document.children {
        push_document_child_text(child, &mut output);
    }

    if output.trim().is_empty() {
        return Err("Il documento .docx non contiene testo estraibile.".to_string());
    }
    Ok(output)
}

/// Un elemento a livello di corpo del documento: solo paragrafi e tabelle
/// portano testo rilevante per l'estrazione — segnalibri, commenti,
/// sommario e structured data tag sono ignorati deliberatamente, non
/// dimenticati.
fn push_document_child_text(child: &docx_rs::DocumentChild, output: &mut String) {
    match child {
        docx_rs::DocumentChild::Paragraph(paragraph) => {
            push_paragraph_text(paragraph, output);
            output.push('\n');
        }
        docx_rs::DocumentChild::Table(table) => push_table_text(table, output),
        _ => {}
    }
}

fn push_paragraph_text(paragraph: &docx_rs::Paragraph, output: &mut String) {
    for child in &paragraph.children {
        if let docx_rs::ParagraphChild::Run(run) = child {
            push_run_text(run, output);
        }
    }
}

fn push_run_text(run: &docx_rs::Run, output: &mut String) {
    for child in &run.children {
        match child {
            docx_rs::RunChild::Text(text) => output.push_str(&text.text),
            docx_rs::RunChild::Tab(_) => output.push('\t'),
            docx_rs::RunChild::Break(_) => output.push('\n'),
            _ => {}
        }
    }
}

/// Una tabella diventa testo tabulare: una riga per riga di tabella, celle
/// separate da tab, ogni cella è il testo di tutti i suoi paragrafi
/// concatenato (una tabella dentro una cella, se presente, non è seguita:
/// caso raro, meglio testo parziale che una ricorsione non necessaria qui).
fn push_table_text(table: &docx_rs::Table, output: &mut String) {
    for row_child in &table.rows {
        let docx_rs::TableChild::TableRow(row) = row_child;
        let mut cells = Vec::with_capacity(row.cells.len());
        for cell_child in &row.cells {
            let docx_rs::TableRowChild::TableCell(cell) = cell_child;
            let mut cell_text = String::new();
            for content in &cell.children {
                if let docx_rs::TableCellContent::Paragraph(paragraph) = content {
                    push_paragraph_text(paragraph, &mut cell_text);
                }
            }
            cells.push(cell_text);
        }
        output.push_str(&cells.join("\t"));
        output.push('\n');
    }
    output.push('\n');
}

/// Estrae un foglio di calcolo come testo tabulare (righe separate da
/// newline, celle da tab), un foglio alla volta con un'intestazione
/// "## Sheet: <nome>". Deliberatamente non strutturato in JSON: un modello
/// legge bene del testo con intestazioni tab-separate, e introdurre un tool
/// dedicato (es. query mirate su righe/colonne) resta una v2 rimandata.
fn extract_spreadsheet_text(path: &Path) -> Result<String, String> {
    let mut workbook = calamine::open_workbook_auto(path)
        .map_err(|e| format!("Impossibile aprire il foglio di calcolo: {e}"))?;

    let sheet_names = workbook.sheet_names().to_owned();
    let mut output = String::new();

    for sheet_name in sheet_names.iter().take(MAX_SPREADSHEET_SHEETS) {
        let Ok(range) = workbook.worksheet_range(sheet_name) else {
            continue;
        };
        output.push_str(&format!("## Sheet: {sheet_name}\n"));
        for row in range.rows().take(MAX_SPREADSHEET_ROWS_PER_SHEET) {
            let cells: Vec<String> = row.iter().map(|cell| cell.to_string()).collect();
            output.push_str(&cells.join("\t"));
            output.push('\n');
        }
        output.push('\n');
    }

    if output.trim().is_empty() {
        return Err("Il foglio di calcolo non contiene dati leggibili.".to_string());
    }
    Ok(output)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_authorized_folder,
            get_authorized_folder,
            search_local_files,
            read_local_file,
            save_generated_file,
            save_generated_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Cartella temporanea univoca per test, ripulita quando esce di scope
    /// (anche se l'assert del test fallisce a metà) — non condivisa con
    /// nessun altro test, anche se cargo test li esegue in parallelo.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("secureagentsdesk-test-{label}-{nanos}"));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn ensure_within_root_allows_a_path_actually_inside_root() {
        let root = TempDir::new("root-ok");
        let file_path = root.0.join("preventivo.txt");
        fs::write(&file_path, "contenuto").unwrap();

        assert!(ensure_within_root(&root.0, &file_path).is_ok());
    }

    #[test]
    fn ensure_within_root_rejects_a_dot_dot_relative_path() {
        let root = TempDir::new("root-traversal");
        let outside = TempDir::new("outside-traversal");
        fs::write(outside.0.join("segreto.txt"), "segreto").unwrap();

        // Stessa costruzione di read_local_file: root.join(relative_path),
        // dove relative_path qui è un "../<cartella-sorella>/segreto.txt"
        // pensato per uscire dalla cartella autorizzata.
        let outside_name = outside.0.file_name().unwrap().to_string_lossy();
        let candidate = root.0.join(format!("../{outside_name}/segreto.txt"));

        assert!(ensure_within_root(&root.0, &candidate).is_err());
    }

    #[test]
    fn ensure_within_root_rejects_a_symlink_escaping_root() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new("root-symlink");
        let outside = TempDir::new("outside-symlink");
        let secret = outside.0.join("segreto.txt");
        fs::write(&secret, "segreto").unwrap();

        let link = root.0.join("link-verso-fuori");
        symlink(&secret, &link).unwrap();

        // Il link vive dentro root (un confronto testuale sul percorso
        // passerebbe), ma canonicalize() lo risolve al bersaglio reale fuori
        // da root: è esattamente questo che ensure_within_root deve cogliere.
        assert!(ensure_within_root(&root.0, &link).is_err());
    }

    #[test]
    fn glob_match_plain_pattern_is_a_substring_match() {
        assert!(glob_match("doc", "relazione.docx"));
        assert!(!glob_match("xyz", "relazione.docx"));
    }

    #[test]
    fn glob_match_supports_extension_wildcard() {
        // Il caso reale che ha fatto scattare questo fix: il modello chiede
        // "*.docx" aspettandosi semantica da shell, non una sottostringa
        // letterale (che non comparirebbe mai in un nome file vero).
        assert!(glob_match("*.docx", "relazione_q3.docx"));
        assert!(!glob_match("*.docx", "relazione_q3.txt"));
    }

    #[test]
    fn glob_match_supports_prefix_and_infix_wildcard() {
        assert!(glob_match("report*", "report_finale.pdf"));
        assert!(!glob_match("report*", "bozza_report.pdf"));
        assert!(glob_match("*draft*", "bozza_draft_v2.txt"));
    }

    #[test]
    fn walk_and_match_finds_file_by_case_insensitive_substring() {
        let root = TempDir::new("walk-match");
        fs::write(root.0.join("Preventivo_Q3.pdf"), "x").unwrap();
        fs::write(root.0.join("altro.txt"), "x").unwrap();

        let mut matches = Vec::new();
        walk_and_match(&root.0, &root.0, "preventivo", 0, &mut matches);

        assert_eq!(matches, vec!["Preventivo_Q3.pdf".to_string()]);
    }

    #[test]
    fn walk_and_match_recurses_into_subdirectories() {
        let root = TempDir::new("walk-recurse");
        let sub = root.0.join("sottocartella");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("relazione.docx"), "x").unwrap();

        let mut matches = Vec::new();
        walk_and_match(&root.0, &root.0, "relazione", 0, &mut matches);

        assert_eq!(matches, vec!["sottocartella/relazione.docx".to_string()]);
    }

    #[test]
    fn walk_and_match_skips_hidden_files_and_directories() {
        let root = TempDir::new("walk-hidden");
        fs::write(root.0.join(".DS_Store"), "x").unwrap();
        let hidden_dir = root.0.join(".git");
        fs::create_dir_all(&hidden_dir).unwrap();
        fs::write(hidden_dir.join("config_preventivo"), "x").unwrap();

        let mut matches = Vec::new();
        walk_and_match(&root.0, &root.0, "preventivo", 0, &mut matches);

        assert!(matches.is_empty());
    }

    #[test]
    fn walk_and_match_stops_at_the_result_cap() {
        let root = TempDir::new("walk-cap");
        for i in 0..(MAX_SEARCH_RESULTS + 10) {
            fs::write(root.0.join(format!("preventivo_{i}.txt")), "x").unwrap();
        }

        let mut matches = Vec::new();
        walk_and_match(&root.0, &root.0, "preventivo", 0, &mut matches);

        assert_eq!(matches.len(), MAX_SEARCH_RESULTS);
    }

    // Fixture reali (non byte hand-rolled): un PDF vero generato con fpdf2 e
    // un XLSX vero generato con openpyxl, incorporati a tempo di compilazione
    // — molto più affidabile che costruire a mano una struttura PDF/XLSX
    // byte-perfetta, che sarebbe fragile e difficile da verificare qui.
    const SAMPLE_PDF: &[u8] = include_bytes!("../tests/fixtures/sample.pdf");
    const SAMPLE_XLSX: &[u8] = include_bytes!("../tests/fixtures/sample.xlsx");
    // Stesso generatore (fpdf2) del PDF con testo sopra, solo senza
    // scriverci nulla — garantisce una struttura valida come il PDF reale,
    // a differenza di un PDF scritto a mano che lopdf potrebbe non riuscire
    // a interpretare affatto (distinguendolo da "nessun testo estratto").
    const BLANK_PDF: &[u8] = include_bytes!("../tests/fixtures/blank.pdf");

    #[test]
    fn extract_pdf_text_reads_a_real_pdf() {
        let root = TempDir::new("pdf-valid");
        let path = root.0.join("relazione.pdf");
        fs::write(&path, SAMPLE_PDF).unwrap();

        match extract_pdf_text(&path).expect("il PDF di test deve essere leggibile") {
            PdfExtraction::Text(text) => assert!(text.contains("Relazione trimestrale Q3")),
            other => panic!("un PDF con testo deve produrre PdfExtraction::Text, non {other:?}"),
        }
    }

    #[test]
    fn extract_pdf_text_fails_gracefully_on_garbage_bytes() {
        let root = TempDir::new("pdf-corrupt");
        let path = root.0.join("corrotto.pdf");
        fs::write(&path, b"non e' affatto un PDF, solo byte a caso").unwrap();

        // Non deve panicare (vedi catch_unwind in extract_pdf_text): un file
        // messo male è un Err gestito, mai un crash dell'intera app.
        assert!(extract_pdf_text(&path).is_err());
    }

    #[test]
    fn extract_pdf_text_reports_a_scanned_pdf_as_needs_ocr() {
        // PDF valido ma senza alcun oggetto testo — lo stesso caso, in
        // pratica, di pagine scansionate come immagini: non più un Err, ma
        // il segnale distinto ScannedNeedsOcr (Rust non fa OCR, ma questo
        // non è più un limite terminale: il chiamante lo instrada al
        // backend via ReadFileResult::NeedsOcr).
        let root = TempDir::new("pdf-no-text");
        let path = root.0.join("scansione.pdf");
        fs::write(&path, BLANK_PDF).unwrap();

        match extract_pdf_text(&path).expect("una pagina senza testo non deve fallire") {
            PdfExtraction::ScannedNeedsOcr => {}
            other => panic!("un PDF senza testo deve produrre ScannedNeedsOcr, non {other:?}"),
        }
    }

    /// Genera al volo un .docx valido (paragrafo + tabella con una cella)
    /// usando l'API di scrittura dello stesso crate docx-rs usato in
    /// lettura — stesso principio delle fixture reali sopra (PDF/XLSX
    /// generati da fpdf2/openpyxl), solo che qui non serve nemmeno un file
    /// binario incorporato: il crate stesso può produrre un .docx
    /// strutturalmente valido a runtime.
    fn write_sample_docx(path: &Path) {
        let table = docx_rs::Table::new(vec![docx_rs::TableRow::new(vec![docx_rs::TableCell::new()
            .add_paragraph(
                docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text("Valore cella")),
            )])]);

        let file = fs::File::create(path).expect("creazione del file docx di test");
        docx_rs::Docx::new()
            .add_paragraph(
                docx_rs::Paragraph::new()
                    .add_run(docx_rs::Run::new().add_text("Relazione trimestrale Q3 DOCX")),
            )
            .add_table(table)
            .build()
            .pack(file)
            .expect("costruzione del docx di test deve riuscire");
    }

    #[test]
    fn extract_docx_text_reads_a_real_docx() {
        let root = TempDir::new("docx-valid");
        let path = root.0.join("relazione.docx");
        write_sample_docx(&path);

        let text = extract_docx_text(&path).expect("il docx di test deve essere leggibile");
        assert!(text.contains("Relazione trimestrale Q3 DOCX"));
        assert!(text.contains("Valore cella"));
    }

    #[test]
    fn extract_docx_text_fails_gracefully_on_garbage_bytes() {
        let root = TempDir::new("docx-corrupt");
        let path = root.0.join("corrotto.docx");
        fs::write(&path, b"non e' affatto un docx, solo byte a caso").unwrap();

        // Non deve panicare (vedi catch_unwind in extract_docx_text): un
        // file messo male è un Err gestito, mai un crash dell'intera app.
        assert!(extract_docx_text(&path).is_err());
    }

    #[test]
    fn extract_file_content_returns_text_for_a_real_pdf() {
        // Regressione: il comportamento per un PDF con testo normale non
        // deve cambiare rispetto a prima di questo refactor.
        let root = TempDir::new("dispatch-pdf-text");
        let path = root.0.join("relazione.pdf");
        fs::write(&path, SAMPLE_PDF).unwrap();

        match extract_file_content(&path, "pdf").expect("il PDF di test deve essere leggibile") {
            ReadFileResult::Text { content } => {
                assert!(content.contains("Relazione trimestrale Q3"));
            }
            other => panic!("un PDF con testo deve produrre ReadFileResult::Text, non {other:?}"),
        }
    }

    #[test]
    fn extract_file_content_reports_a_scanned_pdf_as_needs_ocr() {
        let root = TempDir::new("dispatch-pdf-scanned");
        let path = root.0.join("scansione.pdf");
        fs::write(&path, BLANK_PDF).unwrap();

        match extract_file_content(&path, "pdf").expect("un PDF scansionato non deve fallire") {
            ReadFileResult::NeedsOcr {
                content_base64,
                filename,
            } => {
                assert_eq!(filename, "scansione.pdf");
                assert_eq!(
                    decode_base64_content(&content_base64).expect("base64 valido"),
                    BLANK_PDF
                );
            }
            other => panic!(
                "un PDF scansionato deve produrre ReadFileResult::NeedsOcr, non {other:?}"
            ),
        }
    }

    #[test]
    fn extract_file_content_treats_images_as_needs_ocr_directly() {
        // Rust non tenta mai di leggere un'immagine come testo: sia .jpg che
        // .png devono produrre NeedsOcr direttamente, senza alcun tentativo
        // di parsing — i byte non devono nemmeno essere un'immagine valida,
        // solo byte grezzi passati inalterati (in base64) al chiamante JS.
        for extension in ["jpg", "jpeg", "png"] {
            let root = TempDir::new(&format!("dispatch-image-{extension}"));
            let path = root.0.join(format!("scansione.{extension}"));
            let raw_bytes = b"non sono affatto un'immagine valida, solo byte a caso";
            fs::write(&path, raw_bytes).unwrap();

            match extract_file_content(&path, extension)
                .unwrap_or_else(|e| panic!("un'immagine .{extension} non deve fallire: {e}"))
            {
                ReadFileResult::NeedsOcr {
                    content_base64,
                    filename,
                } => {
                    assert_eq!(filename, format!("scansione.{extension}"));
                    assert_eq!(
                        decode_base64_content(&content_base64).expect("base64 valido"),
                        raw_bytes
                    );
                }
                other => panic!(
                    "un'immagine .{extension} deve produrre ReadFileResult::NeedsOcr, non {other:?}"
                ),
            }
        }
    }

    #[test]
    fn size_limit_for_extension_gives_pdf_and_images_the_larger_ocr_cap() {
        // Trovato in revisione: riusare MAX_READABLE_BYTES (tarato per
        // "quanto testo entra in un prompt") anche per il percorso NeedsOcr
        // avrebbe rifiutato la maggior parte delle foto/scansioni reali
        // (una foto da telefono è tipicamente 2-8MB, ben sopra i 200_000
        // byte di quel cap) prima ancora di arrivare all'OCR — l'unico
        // motivo per cui questo non emergeva dai test esistenti è che tutte
        // le fixture di test (qui sopra) sono sintetiche, poche decine di
        // byte, ben sotto ENTRAMBI i cap.
        for extension in ["pdf", "jpg", "jpeg", "png"] {
            assert_eq!(
                size_limit_for_extension(extension),
                MAX_OCR_SOURCE_BYTES,
                "{extension} deve usare il cap più permissivo (può finire in NeedsOcr)"
            );
        }
        for extension in ["txt", "md", "xlsx", "docx", ""] {
            assert_eq!(
                size_limit_for_extension(extension),
                MAX_READABLE_BYTES,
                "{extension} deve restare sul cap stretto (mai NeedsOcr)"
            );
        }
    }

    #[test]
    fn extract_spreadsheet_text_reads_a_real_xlsx() {
        let root = TempDir::new("xlsx-valid");
        let path = root.0.join("dati.xlsx");
        fs::write(&path, SAMPLE_XLSX).unwrap();

        let text = extract_spreadsheet_text(&path).expect("l'XLSX di test deve essere leggibile");
        assert!(text.contains("Ricavi"));
        assert!(text.contains("Gennaio"));
        assert!(text.contains("1000"));
    }

    #[test]
    fn extract_spreadsheet_text_fails_gracefully_on_garbage_bytes() {
        let root = TempDir::new("xlsx-corrupt");
        let path = root.0.join("corrotto.xlsx");
        fs::write(&path, b"non e' affatto un XLSX, solo byte a caso").unwrap();

        assert!(extract_spreadsheet_text(&path).is_err());
    }

    #[test]
    fn truncate_with_notice_leaves_short_text_untouched() {
        assert_eq!(truncate_with_notice("breve".to_string(), 100), "breve");
    }

    #[test]
    fn truncate_with_notice_truncates_long_text_with_an_explicit_note() {
        let long_text = "a".repeat(50);
        let result = truncate_with_notice(long_text, 10);
        // I primi 10 caratteri sono esattamente il testo originale troncato;
        // il resto è la nota esplicita (che a sua volta contiene delle "a",
        // quindi contare le "a" nell'intero risultato non basterebbe).
        assert!(result.starts_with(&"a".repeat(10)));
        assert!(!result.starts_with(&"a".repeat(11)));
        assert!(result.contains("troncato"));
    }

    #[test]
    fn decode_base64_content_round_trips_binary_bytes() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        // Byte non validi come UTF-8 (0xFF, 0xFE...) — esattamente il tipo
        // di contenuto (un PDF) per cui questo comando esiste, a differenza
        // di save_generated_file che assume testo valido.
        let original: Vec<u8> = vec![0x25, 0x50, 0x44, 0x46, 0xFF, 0xFE, 0x00, 0x01];
        let encoded = STANDARD.encode(&original);

        let decoded = decode_base64_content(&encoded).expect("base64 valido deve decodificare");
        assert_eq!(decoded, original);
    }

    #[test]
    fn decode_base64_content_fails_gracefully_on_invalid_input() {
        let err = decode_base64_content("non e' base64 valido! ***")
            .expect_err("un input non-base64 deve tornare un errore, non panicare");
        assert!(err.contains("base64"));
    }
}
