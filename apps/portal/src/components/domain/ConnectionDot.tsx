import type { DeviceConnection } from '@/lib/api/contracts';
import { DEVICE_CONNECTION } from '@/lib/labels';

const CONNECTION: Record<DeviceConnection, { dot: string }> = {
  // Ponto de "online": único uso de destaque; ponto sólido, sem contorno.
  online: { dot: 'bg-accent' },
  offline: { dot: 'bg-faint' },
  inativo: { dot: 'border border-faint bg-white' },
};

/** Estado de conexão do totem: ponto + texto. */
export function ConnectionDot({ connection }: { connection: DeviceConnection }) {
  const { dot } = CONNECTION[connection];
  const { label } = DEVICE_CONNECTION[connection];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
