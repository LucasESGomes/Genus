'use client';
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './shadcn/sheet';

const WIDTH = { sm: 'sm:max-w-[380px]', md: 'sm:max-w-[480px]', lg: 'sm:max-w-[640px]' } as const;

/** Painel lateral à direita (Sheet). O foco volta ao gatilho ao fechar (Radix). */
export function SidePanel({ open, onOpenChange, title, description, children, footer, width = 'md' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`w-full gap-0 p-0 ${WIDTH[width]}`} {...(description ? {} : { 'aria-describedby': undefined })}>
        <SheetHeader className="border-b border-line p-5 pr-12">
          <SheetTitle className="text-lg font-bold">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <SheetFooter className="flex-row justify-end gap-2 border-t border-line p-4">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
