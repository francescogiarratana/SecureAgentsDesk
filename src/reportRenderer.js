// Assembla un report generato dall'agente (vedi ArtifactOut nel backend) in
// un singolo file HTML autonomo, apribile in un browser vero fuori da
// qualunque sandbox dell'app — questo è esattamente il motivo per cui ogni
// stringa proveniente dal modello va escapata qui, a differenza delle bolle
// di chat (JSX, auto-escaped da React): un documento sorgente avvelenato che
// avesse fatto scrivere al modello qualcosa come "<script>" in una sezione
// diventerebbe uno stored-XSS reale nel file salvato, se non fosse escapato
// prima di finire nel template.
// Percorso relativo nel filesystem, non lo specifier del pacchetto: la
// mappa "exports" di chart.js non espone dist/chart.umd.min.js come
// sottopercorso importabile (solo ".", "./auto", "./helpers"), ma un import
// relativo lo risolve direttamente su disco, ignorando quella mappa — è
// così che il sorgente UMD finisce comunque inlineato a tempo di build,
// mai scaricato da una CDN a runtime.
import chartJsSource from "../node_modules/chart.js/dist/chart.umd.min.js?raw";

const CHART_COLORS = ["#396cd8", "#2f9e44", "#e8590c", "#ae3ec9", "#1098ad", "#f08c00"];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSectionsHtml(sections) {
  return sections
    .map(
      (section) => `
        <section class="report-section">
          <h2>${escapeHtml(section.heading)}</h2>
          <p>${escapeHtml(section.body).replaceAll("\n", "<br>")}</p>
        </section>`
    )
    .join("\n");
}

function chartConfigJson(chart, index) {
  // Ogni stringa (title/labels/nomi serie) è comunque destinata a un
  // contesto JS (JSON.stringify), non HTML — non serve escapeHtml qui, ma
  // resta comunque dato, mai eseguito: Chart.js non interpreta queste
  // stringhe come markup o codice.
  const config = {
    type: chart.type,
    data: {
      labels: chart.labels,
      datasets: chart.series.map((serie, i) => ({
        label: serie.name,
        data: serie.values,
        backgroundColor: CHART_COLORS[(index + i) % CHART_COLORS.length],
        borderColor: CHART_COLORS[(index + i) % CHART_COLORS.length],
      })),
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: chart.title } },
    },
  };
  return JSON.stringify(config);
}

function renderChartsHtml(charts) {
  return charts
    .map(
      (chart, i) => `
        <div class="report-chart">
          <canvas id="chart-${i}"></canvas>
        </div>
        <script>
          new Chart(document.getElementById("chart-${i}"), ${chartConfigJson(chart, i)});
        </script>`
    )
    .join("\n");
}

export function buildStandaloneReportHtml(artifact) {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(artifact.title)}</title>
<style>
  body { font-family: -apple-system, Inter, Arial, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #396cd8; padding-bottom: 0.5rem; }
  .report-summary { color: #555; font-size: 1.05rem; }
  .report-section h2 { color: #396cd8; }
  .report-chart { max-width: 640px; margin: 2rem auto; }
</style>
<script>${chartJsSource}</script>
</head>
<body>
<h1>${escapeHtml(artifact.title)}</h1>
<p class="report-summary">${escapeHtml(artifact.summary)}</p>
${renderSectionsHtml(artifact.sections)}
${renderChartsHtml(artifact.charts)}
<hr>
<p><small>Generato da SecureAgents Desk il ${escapeHtml(new Date(artifact.created_at).toLocaleString("it-IT"))}.</small></p>
</body>
</html>`;
}

export function suggestedReportFileName(artifact) {
  const slug = artifact.title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
  return `${slug || "report"}.html`;
}
