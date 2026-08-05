import { useState, useEffect } from 'react';
import { MicIcon } from './ChatIcons';

export default function DictationButton({ onDictationResult, disabled }) {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'it-IT'; // Lingua italiana

      rec.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        onDictationResult(transcript);
        setIsListening(false);
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      setRecognition(rec);
    }
  }, [onDictationResult]);

  if (!recognition) return null;

  const toggleListen = () => {
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
        setIsListening(true);
      } catch (err) {
        console.error('Failed to start recognition', err);
      }
    }
  };

  return (
    <button
      type="button"
      className={`composer-send-button dictation-button ${isListening ? 'listening' : ''}`}
      onClick={toggleListen}
      disabled={disabled}
      title={isListening ? "In ascolto..." : "Dettatura vocale"}
      aria-label="Dettatura vocale"
      style={{ marginLeft: '8px' }}
    >
      <MicIcon className={isListening ? 'pulse-mic' : ''} />
    </button>
  );
}
