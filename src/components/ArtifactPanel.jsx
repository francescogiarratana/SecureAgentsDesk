import { useEffect, useRef } from "react";
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
          backgroundColor: CHART_COLORS[(index + i) % CHART_COLORS.length],
          borderColor: CHART_COLORS[(index + i) % CHART_COLORS.length],
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

// Anteprima viva di un report generato (generate_report nel backend) — il
// file HTML autonomo scaricabile/condivisibile è una cosa diversa (vedi
// reportRenderer.buildStandaloneReportHtml), pensata per essere aperta fuori
// da quest'app; qui è solo il rendering dentro la finestra di Desk stessa.
export default function ArtifactPanel({ artifact, onSave, saving, savedPath }) {
  if (!artifact) return null;

  return (
    <div className="artifact-panel">
      <div className="artifact-header">
        <strong>{artifact.title}</strong>
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Salvataggio..." : "Salva come HTML"}
        </button>
      </div>
      {artifact.summary && <p className="artifact-summary">{artifact.summary}</p>}
      {artifact.sections.map((section, i) => (
        <div key={i} className="artifact-section">
          <h4>{section.heading}</h4>
          <p>{section.body}</p>
        </div>
      ))}
      {artifact.charts.map((chart, i) => (
        <div key={i} className="artifact-chart">
          <ChartCanvas chart={chart} index={i} />
        </div>
      ))}
      {savedPath && <p className="artifact-saved-note">Salvato in: {savedPath}</p>}
    </div>
  );
}
