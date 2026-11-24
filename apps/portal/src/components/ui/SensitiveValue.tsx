import { can, SENSITIVE_PLACEHOLDER } from '@/lib/auth/permissions';
import type { Role } from '@/lib/api/contracts';

/** CID: só o RH vê. Outros perfis veem "Dado sensível restrito", mesmo que o valor chegue. */
export function CidValue({ role, value }: { role: Role; value: string | null }) {
  if (!can(role, 'certificate.viewCid')) return <span className="text-muted">{SENSITIVE_PLACEHOLDER}</span>;
  return <span>{value ?? '—'}</span>;
}
