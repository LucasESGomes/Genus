import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { tenants } from '../../db/schema';

/**
 * Conta da linha de auditoria de uma leitura filtrada. Filtro por conta que não existe vira ação de
 * plataforma (null): a FK de `auditorias.conta_id` recusaria o INSERT e a leitura viraria 500.
 */
export async function auditTenantId(db: Database, tenantId: number | undefined): Promise<number | null> {
  if (tenantId === undefined) return null;
  const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row ? tenantId : null;
}
