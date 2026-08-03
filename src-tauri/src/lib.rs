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

#[tauri::command]
async fn save_report_html(
    app: AppHandle,
    suggested_file_name: String,
    html: String,
) -> Result<Option<String>, String> {
    // Stesso pattern (oneshot + DialogExt, mai blocking_*) di
    // pick_authorized_folder, con save_file() al posto di pick_folder().
    // Deliberatamente NESSUN ensure_within_root qui: a differenza di
    // search_local_files/read_local_file (l'agente che legge dentro una
    // cartella già autorizzata), questo è un salvataggio scelto e confermato
    // dall'utente stesso tramite il selettore nativo del sistema operativo —
    // lo stesso confine di fiducia già accettato per pick_authorized_folder,
    // non l'agente che scrive a un percorso arbitrario di sua scelta.
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&suggested_file_name)
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

    fs::write(&path, html).map_err(|e| format!("Impossibile scrivere il file: {e}"))?;
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

#[tauri::command]
fn read_local_file(app: AppHandle, relative_path: String) -> Result<String, String> {
    let root = require_authorized_root(&app)?;
    let candidate = root.join(&relative_path);
    let canonical = ensure_within_root(&root, &candidate)?;

    // Limite di dimensione: questo comando serve a passare un estratto al
    // modello dentro un turno di chat, non a streammare file arbitrari di
    // grandi dimensioni nel prompt.
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_READABLE_BYTES {
        return Err(format!(
            "Il file supera il limite di {MAX_READABLE_BYTES} byte leggibili."
        ));
    }

    let extension = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();

    let text = match extension.as_str() {
        "pdf" => extract_pdf_text(&canonical)?,
        "xlsx" | "xlsm" | "xls" | "ods" => extract_spreadsheet_text(&canonical)?,
        // Qualunque altra estensione (.txt, .md, ...) segue il percorso
        // originale invariato: solo PDF e fogli di calcolo hanno bisogno di
        // un'estrazione vera, il resto è già testo.
        _ => fs::read_to_string(&canonical)
            .map_err(|_| "Il file non è testo leggibile (probabilmente binario).".to_string())?,
    };

    Ok(truncate_with_notice(text, MAX_EXTRACTED_TEXT_CHARS))
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

/// Estrae il testo da un PDF. Avvolto in catch_unwind perché un parser
/// puro-Rust su un input binario avversariale (un PDF malformato o
/// deliberatamente corrotto) è una fonte classica di panic — un file messo
/// male non deve poter far morire l'intera app.
fn extract_pdf_text(path: &Path) -> Result<String, String> {
    let owned_path = path.to_path_buf();
    let outcome = std::panic::catch_unwind(move || pdf_extract::extract_text(&owned_path));

    let text = match outcome {
        Ok(Ok(text)) => text,
        Ok(Err(_)) => {
            // pdf-extract non distingue in modo affidabile "protetto da
            // password" da "danneggiato" — un messaggio unificato è più
            // onesto di una falsa precisione che il crate non garantisce.
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
        // pagine scansionate come immagini — un limite di capacità da
        // comunicare come tale, non un bug.
        return Err(
            "Questo PDF non contiene testo estraibile (probabilmente pagine scansionate come \
             immagini): l'OCR non è supportato in questa versione."
                .to_string(),
        );
    }
    Ok(text)
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
            save_report_html,
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

        let text = extract_pdf_text(&path).expect("il PDF di test deve essere leggibile");
        assert!(text.contains("Relazione trimestrale Q3"));
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
    fn extract_pdf_text_reports_a_no_text_pdf_distinctly() {
        // PDF valido ma senza alcun oggetto testo — lo stesso caso, in
        // pratica, di pagine scansionate come immagini: deve produrre il
        // messaggio "OCR non supportato", non un errore di parsing generico.
        let root = TempDir::new("pdf-no-text");
        let path = root.0.join("scansione.pdf");
        fs::write(&path, BLANK_PDF).unwrap();

        let err = extract_pdf_text(&path).expect_err("una pagina senza testo deve fallire");
        assert!(err.contains("OCR"));
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
}
