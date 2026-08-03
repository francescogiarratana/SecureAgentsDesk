import { useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';

// Badge numerata cliccabile per una citazione inline (es. "[1]" nel testo
// generato dal modello). L'hover mostra il titolo della fonte senza dover
// aprire il documento — stesso pattern di Perplexity/NotebookLM.
export function CitationBadge({ citation, onOpen }) {
    const [hovered, setHovered] = useState(false);
    return (
        <span
            className="citation-badge-wrap"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <button type="button" className="citation-badge" onClick={() => onOpen(citation)}>
                {citation.index}
            </button>
            {hovered && (
                <span className="citation-popup" role="tooltip">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '4px'}}>
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                    </svg>
                    {citation.title}
                </span>
            )}
        </span>
    );
}

// react-markdown analizza la sintassi markdown reale (titoli, grassetto,
// corsivo, elenchi...) invece di mostrarne i simboli letterali. Per far
// convivere questo con le badge di citazione, il trucco è trasformare ogni
// "[N]" in un link markdown vero verso uno schema fittizio "citation:N" —
// così il parser lo riconosce come link (non lo lascia testo grezzo) e il
// componente `a` qui sotto lo intercetta per renderizzare la badge invece
// di un'ancora. Un "[N]" già seguito da "(" (cioè già un link) non viene
// toccato, per non rompere un eventuale link reale con etichetta numerica.
function toCitationMarkdownLinks(text) {
    if (!text) return text;
    return text.replace(/\[(\d+)\](?!\()/g, (_, n) => `[${n}](citation:${n})`);
}

function CitationLink({ href, citations, onOpen, children }) {
    const match = href?.match(/^citation:(\d+)$/);
    const citation = match && citations?.find((c) => c.index === Number(match[1]));
    if (citation) {
        return <CitationBadge citation={citation} onOpen={onOpen} />;
    }
    // Link markdown genuino (raro in queste risposte): resta un link normale,
    // non deve rompersi solo perché non è una nostra citazione.
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// react-markdown scarta di default gli URI con schema non riconosciuto
// (solo http/https/mailto/tel/relativi restano intatti) — il nostro "citation:N"
// fittizio verrebbe altrimenti azzerato prima di arrivare al componente `a`,
// rompendo silenziosamente le badge di citazione.
function citationAwareUrlTransform(url) {
    return url.startsWith('citation:') ? url : defaultUrlTransform(url);
}

export function renderMessageContent(text, citations, onOpen) {
    return (
        <Markdown
            urlTransform={citationAwareUrlTransform}
            components={{ a: (props) => <CitationLink {...props} citations={citations} onOpen={onOpen} /> }}
        >
            {toCitationMarkdownLinks(text)}
        </Markdown>
    );
}
