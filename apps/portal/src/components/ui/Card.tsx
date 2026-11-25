import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function Card({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  return <Tag className={cn('rounded-card border border-line bg-white shadow-card', className)}>{children}</Tag>;
}
