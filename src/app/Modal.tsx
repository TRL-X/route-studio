import { Dialog } from '@radix-ui/themes';
import { useState, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  busy,
  className,
  maxWidth,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  maxWidth?: Dialog.ContentProps['maxWidth'];
  children: ReactNode;
}) {
  const [invoker] = useState(() => {
    const active = document.activeElement as HTMLElement | null;
    // Menu commands unmount after selection; restore focus to their persistent trigger.
    const trigger =
      active?.closest('[data-focus-return]')?.getAttribute('data-focus-return') ??
      active?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
    return (trigger && document.getElementById(trigger)) || active;
  });
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Content
        className={className}
        maxWidth={maxWidth}
        aria-describedby={undefined}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (invoker?.isConnected) invoker.focus();
        }}
      >
        <Dialog.Title>{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
}
