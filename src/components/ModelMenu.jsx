import PillMenu from "./PillMenu";

// Selettore modello + livello di ragionamento, sullo stile del selettore
// "Instant High ▾" di Kimi (l'utente lo ha esplicitamente indicato come
// riferimento). Prima erano due <select> nativi nell'header; qui restano
// la stessa scelta di dati (LLM_MODELS/REASONING_EFFORTS passati da
// App.jsx) ma il rendering è unificato in PillMenu e vive nel composer.
export default function ModelMenu({
  model,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  models,
  efforts,
  showEffort,
  disabled,
}) {
  const currentModelLabel = models.find((m) => m.value === model)?.label || model;
  const currentEffortLabel = efforts.find((e) => e.value === reasoningEffort)?.label;

  const sections = [
    {
      key: "model",
      label: "Modello",
      items: models.map((m) => ({
        value: m.value,
        label: m.label,
        selected: m.value === model,
        onSelect: () => onModelChange(m.value),
      })),
    },
  ];
  if (showEffort) {
    sections.push({
      key: "effort",
      label: "Livello di ragionamento",
      items: efforts.map((e) => ({
        value: e.value,
        label: e.label,
        selected: e.value === reasoningEffort,
        onSelect: () => onReasoningEffortChange(e.value),
      })),
    });
  }

  return (
    <PillMenu
      label={currentModelLabel}
      subLabel={showEffort ? currentEffortLabel : null}
      title="Modello e livello di ragionamento"
      disabled={disabled}
      sections={sections}
    />
  );
}
