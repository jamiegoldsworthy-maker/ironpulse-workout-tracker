import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

let openPortalModalCount = 0;
let savedBodyOverflow: string | null = null;

function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (openPortalModalCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openPortalModalCount += 1;
}

function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  openPortalModalCount = Math.max(0, openPortalModalCount - 1);
  if (openPortalModalCount === 0) {
    document.body.style.overflow = savedBodyOverflow ?? '';
    savedBodyOverflow = null;
  }
}

export interface ModalPortalProps {
  open: boolean;
  onClose?: () => void;
  /** 'primary' uses z-index 1000; 'nested' uses z-index 1100 (e.g. pickers or confirmations atop another modal) */
  tier?: 'primary' | 'nested';
  /** Align to bottom on small mobile screens (bottom-sheet style) and center on sm+ */
  sheetOnMobile?: boolean;
  backdropClassName?: string;
  children: React.ReactNode;
}

export const ModalPortal: React.FC<ModalPortalProps> = ({
  open,
  onClose,
  tier = 'primary',
  sheetOnMobile = false,
  backdropClassName,
  children,
}) => {
  const pointerDownOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const zIndex = tier === 'nested' ? 1100 : 1000;

  return createPortal(
    <div
      data-modal-open="true"
      data-no-swipe="true"
      role="dialog"
      aria-modal="true"
      onPointerDown={(e) => {
        pointerDownOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) {
          pointerDownOnBackdropRef.current = false;
        }
      }}
      onClick={(e) => {
        const startedOnBackdrop = pointerDownOnBackdropRef.current;
        pointerDownOnBackdropRef.current = false;
        if (startedOnBackdrop && e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'flex',
        justifyContent: 'center',
      }}
      className={
        backdropClassName ||
        `${
          sheetOnMobile ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-4'
        } bg-black/60 backdrop-blur-xs`
      }
    >
      {children}
    </div>,
    document.body
  );
};
