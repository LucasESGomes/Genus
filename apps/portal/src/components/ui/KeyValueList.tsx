import type { ReactNode } from 'react';

export interface KeyValueItem {
  label: string;
  value: ReactNode;
}

/** Pares rótulo/valor para painéis laterais (`<dl>`). */
export function KeyValueList({ items, className = '' }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(110px,40%)_1fr] gap-x-4 gap-y-3 text-sm ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="m-0 min-w-0 break-words font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
