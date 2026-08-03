// Assembla un report generato dall'agente (vedi ArtifactOut nel backend) in
// un file Markdown — stesso formato già usato per il rendering delle
// risposte in SecureAgentsFrontend (react-markdown), non un template HTML
// su misura. Un .md resta un documento portabile, apribile ovunque, e — a
// differenza di un .html generato — non è mai eseguibile: nessuna difesa
// da XSS necessaria qui (un .html con Chart.js inlineato era la versione
// precedente di questo file; l'utente ha chiesto di passare al markup
// usato per SecureAgents RAG). Il salvataggio come PDF (vedi pdfRenderer.js,
// che riusa slugifyTitle sotto) parte dagli stessi dati strutturati
// dell'artifact, non da questa stringa Markdown.

export function slugifyTitle(title) {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
  return slug || "report";
}

function chartToMarkdownTable(chart) {
  const header = `| ${chart.title} |` + chart.series.map((s) => ` ${s.name} |`).join("");
  const separator = "| --- |" + chart.series.map(() => " --- |").join("");
  const rows = chart.labels.map((label, i) => {
    const cells = chart.series.map((s) => ` ${s.values[i] ?? ""} |`).join("");
    return `| ${label} |${cells}`;
  });
  return [header, separator, ...rows].join("\n");
}

export function buildReportMarkdown(artifact) {
  const parts = [`# ${artifact.title}`, "", artifact.summary, ""];

  for (const section of artifact.sections) {
    parts.push(`## ${section.heading}`, "", section.body, "");
  }

  for (const chart of artifact.charts) {
    parts.push(`### ${chart.title}`, "", chartToMarkdownTable(chart), "");
  }

  parts.push(
    "---",
    `_Generato da SecureAgents Desk il ${new Date(artifact.created_at).toLocaleString("it-IT")}._`
  );

  return parts.join("\n");
}

export function suggestedReportFileName(artifact) {
  if (artifact.suggested_filename) {
    return artifact.suggested_filename.replace(/\.pdf$/, ".md");
  }
  return `${slugifyTitle(artifact.title)}.md`;
}
