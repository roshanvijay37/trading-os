/**
 * Minimal modal + confirm dialog on the institutional panel look. Portal to body,
 * Escape / overlay-click close, aria-modal, initial focus on the dialog card.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button, type Tone } from "./atoms";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-panel border border-border bg-panel shadow-panel outline-none"
      >
        {(title != null) && (
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="ml-auto rounded p-0.5 text-zinc-500 transition hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className="p-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-3 py-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Styled replacement for window.confirm — still blocking in spirit: nothing happens until an explicit choice. */
export function ConfirmDialog({
  open,
  tone = "rose",
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  tone?: Tone;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button tone="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button tone={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-2xs leading-relaxed text-zinc-400">{body}</div>
    </Modal>
  );
}
