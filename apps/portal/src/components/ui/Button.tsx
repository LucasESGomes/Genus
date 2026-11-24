import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover active:bg-brand-active rounded-full px-5 border-0',
  secondary: 'bg-white border border-line-strong hover:bg-surface rounded-full px-[18px]',
  ghost: 'bg-transparent border-0 text-muted hover:bg-surface rounded-md px-3',
};

export function Button({ variant = 'primary', icon, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }) {
  return (
    <button type="button" className={`inline-flex h-10 cursor-pointer items-center gap-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
