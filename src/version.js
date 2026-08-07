import pkg from "../package.json";

// Unica fonte di verità per la versione del Desk: legge package.json
// invece di un secondo numero scritto a mano, che si sarebbe disallineato
// dal primo alla prima release dimenticata (vedi §3.4 del piano pilota).
export const DESK_VERSION = pkg.version;

function parse(version) {
  return String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

// Confronto numerico per componente (major.minor.patch), non lessicografico:
// "10.0.0" deve battere "2.0.0".
export function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isVersionAtLeast(version, minVersion) {
  return compareVersions(version, minVersion) >= 0;
}
