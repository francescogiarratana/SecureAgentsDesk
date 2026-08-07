import { Component } from "react";

// Ultima linea di difesa contro un disallineamento Desk/backend che rompe
// un'assunzione sulla FORMA della risposta (es. un campo che oggi è sempre
// un array e un domani non lo fosse più): senza questo, un'eccezione a
// runtime durante il render lascia una pagina bianca, senza nessun
// messaggio — peggio del "guasto" che §3.4 del piano pilota vuole evitare.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("SecureAgents Desk — errore non gestito:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="login-screen">
          <h1>SecureAgents Desk</h1>
          <p>Si è verificato un errore imprevisto.</p>
          <p className="error-text">
            Se il backend è stato aggiornato di recente, questa versione del Desk
            potrebbe non essere più compatibile. Riavvia l'app; se il problema
            persiste, contatta chi gestisce il server.
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
