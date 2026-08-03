import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "./ChatIcons";

// Pulsante a pillola con popover, condiviso da ModelMenu.jsx e ModeMenu.jsx
// (stesso stile "Instant High ▾" di Kimi indicato dall'utente come
// riferimento per entrambi): una lista di sezioni, ognuna con le sue voci
// selezionabili, così i due selettori del composer restano visivamente e
// comportamentalmente identici senza duplicare la logica del popover.
export default function PillMenu({ label, subLabel, title, disabled, sections }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

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
    <div className="pill-menu" ref={containerRef}>
      <button
        type="button"
        className="pill-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        title={title}
      >
        <span className="pill-menu-trigger-label">{label}</span>
        {subLabel && <span className="pill-menu-trigger-sub">{subLabel}</span>}
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="composer-popover pill-menu-popover">
          {sections.map((section) => (
            <div key={section.key}>
              {section.label && <div className="pill-menu-section-label">{section.label}</div>}
              <ul className="pill-menu-list">
                {section.items.map((item) => (
                  <li key={item.value}>
                    <button
                      type="button"
                      className={`pill-menu-item${item.selected ? " selected" : ""}`}
                      onClick={() => {
                        item.onSelect();
                        setOpen(false);
                      }}
                    >
                      {item.label}
                      {item.selected && <CheckIcon />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
