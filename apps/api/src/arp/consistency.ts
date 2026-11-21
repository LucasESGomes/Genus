/**
 * Conferência entre o banco arp (batidas, da parte do ponto) e o cadastro do RH.
 *
 * O arp não tem cadastro: guarda só `conta_id`, `estabelecimento_id`, `aparelho_id`,
 * `colaborador_id` e `cpf` de cada batida, sem FK (outro banco). Quem dá esses IDs é
 * o RH. Esta função aponta toda referência do arp que não existe no RH, ou que
 * existe com dado diferente (CPF de outra pessoa, aparelho de outro estabelecimento).
 * Só lê; nada é corrigido automaticamente.
 */

/** Uma combinação distinta vinda de `arp.entradas`. */
export interface ArpPunchRef {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  employeeId: number;
  cpf: string;
}

/** Uma combinação distinta vinda de `arp.registros` (tipo 7 tem CPF, sem colaborador_id). */
export interface ArpRecordRef {
  tenantId: number;
  establishmentId: number;
  cpf: string | null;
}

export interface RhSnapshot {
  establishments: { tenantId: number; id: number }[];
  devices: { tenantId: number; id: number; establishmentId: number }[];
  employees: { tenantId: number; id: number; cpf: string }[];
}

export const FINDING_TYPES = [
  'estabelecimento_desconhecido',
  'aparelho_desconhecido',
  'aparelho_de_outro_estabelecimento',
  'colaborador_desconhecido',
  'cpf_divergente',
  'cpf_sem_colaborador',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export interface Finding {
  type: FindingType;
  tenantId: number;
  establishmentId?: number;
  deviceId?: number;
  employeeId?: number;
  /** CPF que veio do arp. Quem imprime deve mascarar (maskCpf). */
  cpf?: string;
}

const key = (...parts: (number | string)[]) => parts.join(':');

export function compareArpWithRh(punches: ArpPunchRef[], records: ArpRecordRef[], rh: RhSnapshot): Finding[] {
  const establishments = new Set(rh.establishments.map((e) => key(e.tenantId, e.id)));
  const devices = new Map(rh.devices.map((d) => [key(d.tenantId, d.id), d.establishmentId]));
  const employees = new Map(rh.employees.map((e) => [key(e.tenantId, e.id), e.cpf]));
  const cpfs = new Set(rh.employees.map((e) => key(e.tenantId, e.cpf)));

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const k = JSON.stringify(f);
    if (!seen.has(k)) {
      seen.add(k);
      findings.push(f);
    }
  };

  const checkEstablishment = (tenantId: number, establishmentId: number) => {
    if (!establishments.has(key(tenantId, establishmentId))) add({ type: 'estabelecimento_desconhecido', tenantId, establishmentId });
  };

  for (const p of punches) {
    checkEstablishment(p.tenantId, p.establishmentId);

    const deviceEstablishment = devices.get(key(p.tenantId, p.deviceId));
    if (deviceEstablishment === undefined) {
      add({ type: 'aparelho_desconhecido', tenantId: p.tenantId, deviceId: p.deviceId });
    } else if (deviceEstablishment !== p.establishmentId) {
      add({ type: 'aparelho_de_outro_estabelecimento', tenantId: p.tenantId, deviceId: p.deviceId, establishmentId: p.establishmentId });
    }

    const cpf = employees.get(key(p.tenantId, p.employeeId));
    if (cpf === undefined) {
      add({ type: 'colaborador_desconhecido', tenantId: p.tenantId, employeeId: p.employeeId });
    } else if (cpf !== p.cpf) {
      add({ type: 'cpf_divergente', tenantId: p.tenantId, employeeId: p.employeeId, cpf: p.cpf });
    }
  }

  for (const r of records) {
    checkEstablishment(r.tenantId, r.establishmentId);
    if (r.cpf !== null && !cpfs.has(key(r.tenantId, r.cpf))) {
      add({ type: 'cpf_sem_colaborador', tenantId: r.tenantId, establishmentId: r.establishmentId, cpf: r.cpf });
    }
  }

  return findings;
}
