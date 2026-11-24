/** Tipos alinhados aos contratos da api (apps/api). Os marcados [MOCK] ainda não existem no back. */
export type Role = 'super_admin' | 'admin' | 'rh' | 'gestor' | 'contador' | 'colaborador';

/** GET /me (apps/api/src/modules/auth/me-routes.ts). */
export interface Me {
  id: number;
  tenantId: number | null;
  employeeId: number | null;
  name: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
  establishmentScope: number[] | null;
  authenticatedVia: 'cookie' | 'jwt';
}

/** [MOCK] GET /portal/establishments: não existe no back. */
export interface Establishment {
  id: number;
  name: string;
  subtitle: string;
}

export type Trend = 'up' | 'down';
export type Tone = 'good' | 'warn' | 'neutral';

/** [MOCK] GET /portal/overview?establishmentId=: não existe no back. Valores já calculados pela api. */
export interface OverviewKpi {
  key: 'workedHours' | 'overtimeHours' | 'absences' | 'pendingCertificates' | 'activeVacations';
  label: string;
  value: string;
  unit: string;
  delta: string;
  trend: Trend;
  tone: Tone;
  comparison: string;
}

export interface OverviewAlert {
  id: string;
  severity: 'alerta' | 'sinal';
  title: string;
  text: string;
  cta: string;
  target: 'apuracao' | 'escalas';
}

export interface Overview {
  kpis: OverviewKpi[];
  alerts: OverviewAlert[];
}

export interface Envelope<T> {
  data: T;
}
