"use client";

import { useEffect, useRef } from "react";

// A centred dialog over a dimmed page. Closes on Escape or a click outside; focus moves into it.
export function Modal({ title, onClose, wide, children, footer }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();

    ref.current?.focus();
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="pp-modal__backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`pp-modal${wide ? " pp-modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="pp-modal__head">
          <h2>{title}</h2>
          <button type="button" className="pp-btn pp-btn--icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="pp-modal__body">{children}</div>
        {footer && <footer className="pp-modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}
