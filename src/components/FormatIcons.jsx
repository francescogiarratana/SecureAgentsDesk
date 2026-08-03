// Icone dei due formati di salvataggio di un report (vedi ArtifactPanel).
// SVG inline, non una libreria di icone aggiuntiva: servono solo questi tre
// glifi in tutta l'app, non vale la pena di una nuova dipendenza per così
// poco. currentColor per ereditare il colore del pulsante (funziona anche
// in dark mode senza varianti separate).

export function MarkdownFormatIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 208 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="200" height="120" rx="10" stroke="currentColor" strokeWidth="10" />
      <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39H30z" fill="currentColor" />
      <path d="M155 30v35h20l-30 35-30-35h20V30h20z" fill="currentColor" />
    </svg>
  );
}

export function PdfFormatIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6 2h8l6 6v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <text x="12" y="18.5" fontSize="7.2" fontWeight="700" textAnchor="middle" fill="currentColor" fontFamily="sans-serif">
        PDF
      </text>
    </svg>
  );
}

export function SpinnerIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="format-icon-spinner" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
