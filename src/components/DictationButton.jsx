import { useState, useEffect, useRef, useCallback } from 'react';
import { MicIcon } from './ChatIcons';

export default function DictationButton({ onDictationResult, disabled }) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  const recognitionRef = useRef(null);
  const onResultRef = useRef(onDictationResult);

  // Rileva se l'applicazione sta girando all'interno del contenitore Desktop Tauri
  const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

  // Memorizza onDictationResult in una ref per evitare ricreazioni da re-render
  useEffect(() => {
    onResultRef.current = onDictationResult;
  }, [onDictationResult]);

  // Controlla supporto ed eventuale ambiente desktop all'avvio
  useEffect(() => {
    if (isTauri) {
      // Verificato empiricamente (non solo presunto): window.webkitSpeechRecognition
      // ESISTE dentro il WKWebView di Tauri su macOS (Safari lo supporta da 14.1+,
      // e questa build ha i due Info.plist NSMicrophoneUsageDescription/
      // NSSpeechRecognitionUsageDescription correttamente incorporati — confermato
      // leggendo il bundle .app prodotto da `tauri build`, non solo tauri.conf.json).
      // navigator.mediaDevices.getUserMedia({audio:true}) funziona correttamente
      // nello stesso binario. MA rec.start() (SpeechRecognition, categoria TCC
      // separata dal microfono) fa crashare l'intero processo con SIGABRT — non un
      // errore JS recuperabile via onerror/catch, un crash nativo a livello di OS.
      // Il crash reporter di macOS lo attribuisce a "Namespace TCC ... must contain
      // an NSSpeechRecognitionUsageDescription key", nonostante la chiave sia
      // presente: la vera causa è che questa build è firmata ad-hoc
      // (codeSigningTeamID vuoto) e TCC non concede l'accesso al servizio di
      // riconoscimento vocale — a differenza del microfono, più permissivo — a un
      // binario non firmato con un Developer ID Apple reale. Non risolvibile lato
      // codice: richiederebbe firma+notarizzazione con un account Apple Developer
      // reale per l'app, che è una decisione di infrastruttura/distribuzione, non
      // di questo componente. Vedi README.md, sezione "Limiti noti".
      setIsSupported(true);
      setErrorMessage("Dettatura vocale non disponibile nell'app desktop. Usa il browser.");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      setErrorMessage("Dettatura vocale non supportata da questo browser.");
    }
  }, [isTauri]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(async () => {
    if (isTauri) {
      setErrorMessage("Dettatura vocale non disponibile nell'app desktop. Usa il browser.");
      return;
    }

    setErrorMessage(null);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      setErrorMessage("Dettatura vocale non supportata da questo browser.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {
        // ignore
      }
      recognitionRef.current = null;
    }

    // Richiedi permesso microfono prima di start()
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (permErr) {
      console.error('Microphone permission denied or unavailable:', permErr);
      setErrorMessage("Permesso microfono negato o dispositivo non disponibile.");
      setIsListening(false);
      return;
    }

    // Istanza SpeechRecognition per browser
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'it-IT';

    rec.onstart = () => {
      setIsListening(true);
      setErrorMessage(null);
    };

    rec.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal || !event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript && onResultRef.current) {
        onResultRef.current(finalTranscript.trim());
      }
    };

    rec.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'service-not-allowed') {
        setErrorMessage("Non supportato nel runtime desktop (service-not-allowed). Usa il browser.");
      } else if (event.error === 'not-allowed') {
        setErrorMessage("Permesso microfono o riconoscimento vocale non autorizzato.");
      } else if (event.error === 'audio-capture') {
        setErrorMessage("Nessun microfono rilevato dal sistema.");
      } else if (event.error !== 'no-speech') {
        setErrorMessage(`Errore dettatura: ${event.error}`);
      }
      stopListening();
    };

    rec.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;

    try {
      rec.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setErrorMessage("Impossibile avviare il servizio di riconoscimento vocale.");
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [isTauri, stopListening]);

  // Clean up all'unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
    };
  }, []);

  const toggleListen = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const isDisabled = disabled || !isSupported || Boolean(errorMessage);
  const buttonTitle = isTauri
    ? "Dettatura vocale non disponibile nell'app desktop. Usa la versione Browser."
    : !isSupported
    ? "Dettatura vocale non supportata in questo browser"
    : errorMessage
    ? errorMessage
    : isListening
    ? "In ascolto... Clicca per fermare"
    : "Dettatura vocale";

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
      <button
        type="button"
        className={`composer-send-button dictation-button ${isListening ? 'listening' : ''} ${isDisabled ? 'disabled' : ''}`}
        onClick={toggleListen}
        disabled={isDisabled}
        title={buttonTitle}
        aria-label="Dettatura vocale"
        style={{
          marginLeft: '8px',
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer'
        }}
      >
        <MicIcon className={isListening ? 'pulse-mic' : ''} />
      </button>
      {errorMessage && (
        <span
          className="dictation-error-tooltip"
          title={errorMessage}
          style={{
            fontSize: '11px',
            color: '#ef4444',
            marginLeft: '8px',
            maxWidth: '220px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
