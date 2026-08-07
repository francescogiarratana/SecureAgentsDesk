import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import { MarkdownFormatIcon, PdfFormatIcon, SpinnerIcon } from "./FormatIcons";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  BarController,
  LineController,
  PieController,
} from "chart.js";

// Registrazione una tantum a livello di modulo (Chart.js v4 è modulare:
// niente funziona finché i controller/elementi usati non sono registrati).
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  BarController,
  LineController,
  PieController
);

const CHART_COLORS = ["#396cd8", "#2f9e44", "#e8590c", "#ae3ec9", "#1098ad", "#f08c00"];

function ChartCanvas({ chart, index }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const instance = new ChartJS(canvasRef.current, {
      type: chart.type,
      data: {
        labels: chart.labels,
        datasets: chart.series.map((serie, i) => ({
          label: serie.name,
          data: serie.values,
          backgroundColor: chart.type === 'pie' ? CHART_COLORS : CHART_COLORS[(index + i) % CHART_COLORS.length],
          borderColor: chart.type === 'pie' ? CHART_COLORS : CHART_COLORS[(index + i) % CHART_COLORS.length],
        })),
      },
      options: { responsive: true, plugins: { title: { display: true, text: chart.title } } },
    });
    // Chart.js non si smonta da solo: senza destroy() ogni nuovo report
    // aperto lascerebbe un'istanza precedente viva, aggrappata a un canvas
    // che React ha già rimosso dal DOM.
    return () => instance.destroy();
  }, [chart, index]);

  return <canvas ref={canvasRef} />;
}

// Anteprima viva di un report generato (generate_report nel backend),
// mostrata come parte della risposta stessa (stesso principio di Claude
// Code/Perplexity: il documento generato è un allegato dentro il turno,
// non qualcosa che si va a cercare altrove). Il testo (sintesi, sezioni) è
// markdown vero, con lo stesso componente già usato per le risposte in
// SecureAgentsFrontend (react-markdown) — non testo semplice. I file
// esportabili/condivisibili sono un'altra cosa (vedi reportRenderer.js per
// il Markdown, pdfRenderer.js per il PDF), pensati per essere aperti fuori
// da quest'app; qui è solo il rendering dentro la finestra di Desk stessa.
export default function ArtifactPanel({
  artifact,
  onSaveMarkdown,
  onSavePdf,
  savingFormat,
  savedMarkdownPath,
  savedPdfPath,
}) {
  const panelRef = useRef(null);
  if (!artifact) return null;
  const hasContent = Boolean(
    (artifact.summary && artifact.summary.trim()) ||
      (artifact.sections && artifact.sections.length > 0) ||
      (artifact.charts && artifact.charts.length > 0)
  );
  if (!hasContent) return null;

  // Il PDF (vedi pdfRenderer.buildReportPdfDefinition) porta i grafici come
  // immagini: vanno catturate QUI, dal <canvas> live già renderizzato da
  // ChartCanvas sotto, al momento del click — non c'è altro punto in cui
  // esiste già un canvas disegnato da cui prendere i pixel.
  function handleSavePdf() {
    const chartImages = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll("canvas")).map((c) => c.toDataURL("image/png"))
      : [];
    onSavePdf(chartImages);
  }

  return (
    <div className="artifact-panel" ref={panelRef}>
      <div className="artifact-header">
        <strong>{artifact.title}</strong>
        <div className="artifact-save-actions">
          <button
            type="button"
            className="artifact-save-icon-button"
            title="Salva come Markdown"
            aria-label="Salva come Markdown"
            onClick={onSaveMarkdown}
            disabled={Boolean(savingFormat)}
          >
            {savingFormat === "markdown" ? <SpinnerIcon /> : <MarkdownFormatIcon />}
          </button>
          <button
            type="button"
            className="artifact-save-icon-button"
            title="Salva come PDF"
            aria-label="Salva come PDF"
            onClick={handleSavePdf}
            disabled={Boolean(savingFormat)}
          >
            {savingFormat === "pdf" ? <SpinnerIcon /> : <PdfFormatIcon />}
          </button>
        </div>
      </div>
      {artifact.summary && (
        <div className="artifact-summary">
          <Markdown>{artifact.summary}</Markdown>
        </div>
      )}
      {(artifact.sections ?? []).map((section, i) => (
        <div key={i} className="artifact-section">
          <h4>{section.heading}</h4>
          <Markdown>{section.body}</Markdown>
        </div>
      ))}
      {(artifact.charts ?? []).map((chart, i) => (
        <div key={i} className="artifact-chart">
          <ChartCanvas chart={chart} index={i} />
        </div>
      ))}
      {(savedMarkdownPath || savedPdfPath) && (
        <p className="artifact-saved-note">
          {savedMarkdownPath && <>Markdown salvato in: {savedMarkdownPath}</>}
          {savedMarkdownPath && savedPdfPath && <br />}
          {savedPdfPath && <>PDF salvato in: {savedPdfPath}</>}
        </p>
      )}
    </div>
  );
}
