import PillMenu from "./PillMenu";

// Selettore di modalità (Pianifica/Passo-passo/Rapida), stesso design a
// pillola di ModelMenu — l'utente ha chiesto esplicitamente di portare
// anche questo selettore nel composer con lo stesso stile. Nota di
// sicurezza invariata: mode resta una scelta di rendering lato client
// (vedi MODES in App.jsx), mai qualcosa che il backend legge per decidere
// se un'azione WRITE richiede approvazione — quel gate vive solo in
// policy_engine.evaluate, indipendente da questo valore.
export default function ModeMenu({ mode, onModeChange, modes, disabled }) {
  const currentLabel = modes.find((m) => m.value === mode)?.label || mode;

  const sections = [
    {
      key: "mode",
      label: "Modalità",
      items: modes.map((m) => ({
        value: m.value,
        label: m.label,
        selected: m.value === mode,
        onSelect: () => onModeChange(m.value),
      })),
    },
  ];

  return (
    <PillMenu
      label={currentLabel}
      title="Modalità"
      disabled={disabled}
      sections={sections}
    />
  );
}
