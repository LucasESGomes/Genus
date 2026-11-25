import { cn } from '@/lib/utils';
import { SpinnerGap } from '@phosphor-icons/react/dist/ssr';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover active:bg-brand-active rounded-full px-5 border-0',
  secondary: 'bg-white border border-line-strong hover:bg-surface rounded-full px-[18px]',
  ghost: 'bg-transparent border-0 text-muted hover:bg-surface rounded-md px-3',
  // Destaque: no máximo um por tela (docs/portal-arquitetura-front.md §6). Texto sempre on-accent.
  accent: 'bg-accent text-on-accent hover:brightness-95 active:brightness-90 rounded-full px-5 border-0',
  danger: 'bg-danger text-white hover:brightness-95 active:brightness-90 rounded-full px-5 border-0',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 text-xs',
  md: 'h-10',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Desabilita o botão e anuncia "ocupado" (aria-busy). */
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', icon, loading = false, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn('inline-flex cursor-pointer items-center justify-center gap-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60', SIZE[size], VARIANT[variant], className)}
      {...rest}
    >
      {loading ? <SpinnerGap size={size === 'sm' ? 14 : 18} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
