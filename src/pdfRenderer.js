// Converte un report generato (vedi ArtifactOut nel backend) in un PDF vero
// — testo vettoriale selezionabile/ricercabile, non uno screenshot della
// pagina — usando pdfmake (scelto dopo aver verificato dal vivo su npm/
// bundlephobia: jsPDF in modalità .html()/html2canvas produce solo
// un'immagine rasterizzata per pagina, la sua API di disegno manuale
// richiederebbe di reimplementare a mano tutto ciò che pdfmake offre già
// come struttura dichiarativa — vedi la ricerca in questa stessa sessione).
//
// import() dinamico in generateReportPdfBase64, non un import statico qui
// in cima al file: pdfmake pesa ~340KB gzip coi font Roboto inclusi, e il
// build Vite segnala già un chunk sopra i 500KB — non ha senso caricarlo
// finché l'utente non clicca davvero "Salva come PDF".
// Estensione .js esplicita: Vite la risolverebbe anche senza, ma così questo
// modulo resta importabile anche da Node (usato per verificarne l'output con
// un parser PDF reale, vedi la verifica in questa stessa sessione).
import { slugifyTitle } from "./reportRenderer.js";

// Sottoinsieme di markdown effettivamente prodotto dal modello per summary/
// section.body (vedi generate_report nel backend): titoli #/##/###,
// **grassetto**, *corsivo*/_corsivo_, elenchi puntati "- "/"* ", paragrafi
// semplici. Non un parser markdown completo (niente tabelle, link, codice):
// pdfmake ha il suo formato dichiarativo, non serve passare da HTML.
function parseInlineRuns(text) {
  const runs = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      runs.push({ text: match[1], bold: true });
    } else {
      runs.push({ text: match[2] ?? match[3], italics: true });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex) });
  }
  return runs.length > 0 ? runs : [{ text }];
}

function headingLevel(line) {
  const match = line.match(/^(#{1,3})\s+(.*)/);
  return match ? { level: match[1].length, text: match[2] } : null;
}

function isBulletLine(line) {
  return /^[-*]\s+/.test(line);
}

const HEADING_STYLE_BY_LEVEL = { 1: "mdH1", 2: "mdH2", 3: "mdH3" };

export function markdownToPdfContent(markdown) {
  if (!markdown || !markdown.trim()) return [];

  const blocks = markdown.trim().split(/\n\s*\n/);
  const content = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const heading = headingLevel(lines[0]);
    if (heading && lines.length === 1) {
      content.push({
        text: heading.text,
        style: HEADING_STYLE_BY_LEVEL[heading.level] || "mdH3",
      });
      continue;
    }

    if (lines.every(isBulletLine)) {
      content.push({
        ul: lines.map((line) => parseInlineRuns(line.replace(/^[-*]\s+/, ""))),
        margin: [0, 0, 0, 8],
      });
      continue;
    }

    content.push({ text: parseInlineRuns(lines.join(" ")), margin: [0, 0, 0, 8] });
  }

  return content;
}

export function buildReportPdfDefinition(artifact, chartImages = []) {
  const content = [{ text: artifact.title, style: "title" }];

  content.push(...markdownToPdfContent(artifact.summary));

  for (const section of artifact.sections) {
    content.push({ text: section.heading, style: "sectionHeading" });
    content.push(...markdownToPdfContent(section.body));
  }

  artifact.charts.forEach((chart, i) => {
    // Un chart senza la sua immagine catturata (vedi ArtifactPanel, che la
    // cattura dal <canvas> live al momento del click) viene saltato invece
    // di far fallire l'intero PDF: meglio un report incompleto di un chart
    // che uno vuoto per un errore altrove.
    const image = chartImages[i];
    if (!image) return;
    content.push({ text: chart.title, style: "chartTitle" });
    content.push({ image, width: 460, margin: [0, 4, 0, 16] });
  });

  content.push({
    text: `Generato da SecureAgents Desk il ${new Date(artifact.created_at).toLocaleString("it-IT")}.`,
    style: "footerNote",
  });

  return {
    content,
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 16] },
      sectionHeading: { fontSize: 14, bold: true, margin: [0, 16, 0, 8] },
      chartTitle: { fontSize: 12, bold: true, margin: [0, 8, 0, 0] },
      footerNote: { fontSize: 9, italics: true, color: "#777777", margin: [0, 24, 0, 0] },
      mdH1: { fontSize: 16, bold: true, margin: [0, 12, 0, 8] },
      mdH2: { fontSize: 14, bold: true, margin: [0, 10, 0, 6] },
      mdH3: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
    },
    defaultStyle: { fontSize: 11, lineHeight: 1.3 },
    pageMargins: [50, 50, 50, 50],
  };
}

export async function generateReportPdfBase64(artifact, chartImages = []) {
  const [{ default: pdfMake }, { default: pdfFonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(pdfFonts);

  const docDefinition = buildReportPdfDefinition(artifact, chartImages);
  // pdfmake 0.3.x: getBase64() è async e ritorna direttamente una Promise<string>
  // (non più la vecchia API a callback delle versioni precedenti — verificato
  // dal vivo: un callback passato qui non viene mai richiamato, la Promise
  // resta per sempre in sospeso).
  return pdfMake.createPdf(docDefinition).getBase64();
}

export function suggestedReportPdfFileName(artifact) {
  return `${slugifyTitle(artifact.title)}.pdf`;
}
