/** Marca do Genus (quadrado azul com ponto de destaque), igual à do design. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`relative h-7 w-7 shrink-0 rounded-sm bg-brand ${className}`} aria-hidden>
      <div className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" />
      <div className="absolute right-1.5 bottom-[7px] left-1.5 h-[3px] rounded-[2px] bg-white" />
    </div>
  );
}
