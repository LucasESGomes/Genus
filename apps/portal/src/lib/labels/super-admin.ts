/**
 * Rótulos em pt-BR do painel do super_admin. Cada tabela é tipada contra a união
 * de lib/api/super-admin-contracts.ts: um valor novo no back quebra o typecheck
 * aqui até ganhar rótulo.
 */
import type {
  HealthService,
  HealthState,
  IpFlagReason,
  LoginFailureReason,
  LoginStep,
  ModuleUsage,
  StatsWindow,
  TenantStatus,
  AuditAction,
} from '../api/super-admin-contracts';

export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  ativa: 'Ativa',
  suspensa: 'Suspensa',
};

export const HEALTH_STATE_LABEL: Record<HealthState, string> = {
  ok: 'Operando',
  degraded: 'Degradado',
  down: 'Fora do ar',
};

export const HEALTH_SERVICE_LABEL: Record<HealthService, string> = {
  api: 'API do RH',
  postgres_app: 'Banco do RH',
  postgres_arp: 'Banco fiscal (ARP)',
  valkey: 'Fila (Valkey)',
  face_engine: 'Motor facial',
  collector_api: 'API do coletor',
  rep_core: 'REP-core (NSR)',
  jobs: 'Jobs pós-batida',
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  criacao: 'Criação',
  alteracao: 'Alteração',
  exclusao: 'Exclusão',
  leitura_sensivel: 'Leitura sensível',
  aprovacao: 'Aprovação',
  recusa: 'Recusa',
  fechamento: 'Fechamento',
  reabertura: 'Reabertura',
};

export type AuditEntity = 'tenant' | 'tenant_admin' | 'session' | 'super_admin' | 'audit_log' | 'access_log' | 'recognition_stats' | 'tenant_stats';

export const AUDIT_ENTITY_LABEL: Record<AuditEntity, string> = {
  tenant: 'Empresa',
  tenant_admin: 'Administrador da empresa',
  session: 'Sessão',
  super_admin: 'Super admin',
  audit_log: 'Auditoria',
  access_log: 'Acessos',
  recognition_stats: 'Reconhecimento (agregado)',
  tenant_stats: 'Estatísticas da empresa',
};

/** Entidade que não está na tabela acima: mostra o valor cru, sem quebrar a tela. */
export function auditEntityLabel(entity: string): string {
  return Object.hasOwn(AUDIT_ENTITY_LABEL, entity) ? AUDIT_ENTITY_LABEL[entity as AuditEntity] : entity;
}

export const LOGIN_STEP_LABEL: Record<LoginStep, string> = {
  senha: 'Senha',
  totp: 'Código do app',
};

export const LOGIN_FAILURE_LABEL: Record<LoginFailureReason, string> = {
  credencial_invalida: 'E-mail ou senha incorretos',
  usuario_inativo: 'Usuário inativo',
  conta_suspensa: 'Conta suspensa',
  totp_invalido: 'Código do app inválido',
};

export const IP_FLAG_REASON_LABEL: Record<IpFlagReason, string> = {
  muitas_falhas: 'Muitas falhas de login',
  muitas_contas: 'Muitas contas diferentes',
};

export const WINDOW_LABEL: Record<StatsWindow, string> = {
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
};

export const MODULE_USAGE_LABEL: Record<keyof ModuleUsage, string> = {
  adjustments: 'Ajustes de ponto',
  certificates: 'Atestados',
  vacations: 'Férias',
  absences: 'Afastamentos',
  closings: 'Fechamentos',
};

export interface EmptyStateText {
  title: string;
  description: string;
}

export const SUPER_ADMIN_EMPTY: Record<
  'tenants' | 'tenantsSearch' | 'audit' | 'sessions' | 'loginAttempts' | 'flaggedIps' | 'recognition' | 'recognitionDevices' | 'growth',
  EmptyStateText
> = {
  tenants: {
    title: 'Nenhuma empresa cadastrada',
    description: 'Cadastre a primeira empresa para liberar o acesso do administrador.',
  },
  tenantsSearch: {
    title: 'Nenhuma empresa encontrada',
    description: 'Confira o nome ou o status pesquisado.',
  },
  audit: {
    title: 'Nenhum registro de auditoria',
    description: 'Nenhuma ação foi registrada com estes filtros.',
  },
  sessions: {
    title: 'Nenhuma sessão encontrada',
    description: 'Nenhuma sessão corresponde a estes filtros.',
  },
  loginAttempts: {
    title: 'Nenhuma tentativa de login',
    description: 'Nenhuma tentativa de entrada corresponde a estes filtros.',
  },
  flaggedIps: {
    title: 'Nenhum IP sinalizado',
    description: 'Nenhum endereço passou dos limites no período. Sinalizar não bloqueia ninguém.',
  },
  recognition: {
    title: 'Sem batidas no período',
    description: 'Nenhuma batida foi registrada na janela escolhida.',
  },
  recognitionDevices: {
    title: 'Nenhum aparelho com batidas',
    description: 'Nenhum aparelho registrou batidas na janela escolhida.',
  },
  growth: {
    title: 'Sem histórico de crescimento',
    description: 'Ainda não há empresas cadastradas nos meses selecionados.',
  },
};

export const SUPER_ADMIN_ERRORS: Record<
  | 'ACCOUNT_SUSPENDED'
  | 'MFA_REQUIRED'
  | 'MASTER_KEY_AUSENTE'
  | 'TENANT_ALREADY_SUSPENDED'
  | 'TENANT_NOT_SUSPENDED'
  | 'EMAIL_IN_USE'
  | 'CNPJ_INVALIDO'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR',
  string
> = {
  ACCOUNT_SUSPENDED: 'Conta suspensa. Fale com o suporte do Genus.',
  MFA_REQUIRED: 'Ative a verificação em duas etapas para continuar.',
  MASTER_KEY_AUSENTE: 'A api não tem a MASTER_KEY: a empresa não pode ser criada agora. Configure a variável e tente de novo.',
  TENANT_ALREADY_SUSPENDED: 'Esta empresa já está suspensa.',
  TENANT_NOT_SUSPENDED: 'Esta empresa não está suspensa.',
  EMAIL_IN_USE: 'Este e-mail já está em uso na plataforma.',
  CNPJ_INVALIDO: 'CNPJ inválido. Confira os dígitos.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Não encontramos o registro pedido.',
  VALIDATION_ERROR: 'Revise os campos e tente de novo.',
};

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

/** Mensagem para um código de erro da api; código desconhecido ou ausente cai na genérica. */
export function superAdminErrorMessage(code: string | undefined): string {
  if (!code) return GENERIC_ERROR;
  return Object.hasOwn(SUPER_ADMIN_ERRORS, code) ? SUPER_ADMIN_ERRORS[code as keyof typeof SUPER_ADMIN_ERRORS] : GENERIC_ERROR;
}

export const RECOGNITION_UNAVAILABLE_TEXT = 'Indisponível: depende do coletor gravar as tentativas';

export const TEMP_PASSWORD_WARNING =
  'Esta senha aparece só agora. Copie e entregue ao administrador da empresa por um canal seguro.';
