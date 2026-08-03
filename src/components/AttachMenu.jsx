import { useEffect, useRef, useState } from "react";
import { PaperclipIcon, PlusIcon } from "./ChatIcons";

// Popover del bottone "+" del composer, ispirato a Kimi (vedi la sessione:
// il suo menu su "+" apre "Add files & photos / Plugins / Skills / Web
// search"). Qui c'è una sola voce reale — Allega file — perché è l'unica
// che l'app sa davvero fare oggi: aggiungere voci che sembrano funzionare
// ma non lo fanno (es. un "Connettori" senza alcuna integrazione dietro)
// sarebbe un'interfaccia bugiarda, non un miglioramento.
export default function AttachMenu({ onFilesSelected, disabled }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="attach-menu" ref={containerRef}>
      <button
        type="button"
        className="composer-icon-button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        title="Allega"
        aria-label="Allega"
      >
        <PlusIcon />
      </button>
      {open && (
        <div className="composer-popover attach-menu-popover">
          <button
            type="button"
            className="attach-menu-item"
            onClick={() => {
              inputRef.current?.click();
              setOpen(false);
            }}
          >
            <PaperclipIcon />
            Allega file
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          onFilesSelected(event);
          setOpen(false);
        }}
      />
    </div>
  );
}
