/**
 * Rótulos em pt-BR dos valores de enumeração de lib/api/contracts.ts. Cada tabela
 * é tipada contra a união do contrato: um valor novo no back quebra o typecheck
 * aqui até ganhar rótulo.
 */
import type {
  DaySituation,
  CalibrationState,
  DeviceConnection,
  ReportType,
  AdjustmentStatus,
  AdjustmentType,
  AiFailure,
  AiStatus,
  AnalysisProvider,
  AuthenticatedVia,
  CertificateStatus,
  CidSource,
  CidStatus,
  ClosingStatus,
  ContractType,
  CycleType,
  EmployeeStatus,
  FieldItem,
  FieldStatus,
  FindingSeverity,
  IssueType,
  ManualAbsenceType,
  PunchOrigin,
  RecalculateSkipReason,
  DayRecalculateSkipReason,
  TimeBankModality,
  Recommendation,
  ReliabilityBand,
  RiskLevel,
  Role,
  ScheduleType,
  ScheduleWarningCode,
  TimesheetDayStatus,
  Tone,
  Trend,
  VacationStatus,
} from '../api/contracts';

export type LabelTone = 'good' | 'warn' | 'danger' | 'neutral' | 'info';

export interface Label {
  label: string;
  tone: LabelTone;
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  rh: 'RH',
  gestor: 'Gestor',
  contador: 'Contador',
  colaborador: 'Colaborador',
};

export const AUTHENTICATED_VIA_LABEL: Record<AuthenticatedVia, Label> = {
  cookie: { label: 'Cookie', tone: 'neutral' },
  jwt: { label: 'Token JWT', tone: 'neutral' },
};

export const EMPLOYEE_STATUS: Record<EmployeeStatus, Label> = {
  ativo: { label: 'Ativo', tone: 'good' },
  desligado: { label: 'Desligado', tone: 'neutral' },
};

export const CONTRACT_TYPE: Record<ContractType, Label> = {
  indeterminado: { label: 'Prazo indeterminado', tone: 'neutral' },
  determinado: { label: 'Prazo determinado', tone: 'neutral' },
  safra: { label: 'Safra', tone: 'neutral' },
  intermitente: { label: 'Intermitente', tone: 'neutral' },
};

export const SCHEDULE_TYPE: Record<ScheduleType, Label> = {
  '5x2': { label: '5 dias por 2 de folga', tone: 'neutral' },
  '6x1': { label: '6 dias por 1 de folga', tone: 'neutral' },
  '12x36': { label: '12 h de trabalho por 36 h de descanso', tone: 'neutral' },
  livre: { label: 'Livre', tone: 'neutral' },
};

export const CYCLE_TYPE: Record<CycleType, Label> = {
  semanal: { label: 'Semanal', tone: 'neutral' },
  ciclico: { label: 'Cíclica', tone: 'neutral' },
};

export const SCHEDULE_WARNING_CODE: Record<ScheduleWarningCode, Label> = {
  carga_semanal_acima_limite: { label: 'Carga semanal acima do limite', tone: 'warn' },
  folgas_abaixo_minimo: { label: 'Folgas abaixo do mínimo', tone: 'warn' },
};

export const TIMESHEET_DAY_STATUS: Record<TimesheetDayStatus, Label> = {
  calculada: { label: 'Calculada', tone: 'good' },
  inconsistente: { label: 'Inconsistente', tone: 'danger' },
};

export const PUNCH_ORIGIN: Record<PunchOrigin, Label> = {
  original: { label: 'Original', tone: 'neutral' },
  tratada: { label: 'Tratada', tone: 'info' },
};

export const ISSUE_TYPE: Record<IssueType, Label> = {
  batida_faltando: { label: 'Batida faltando', tone: 'danger' },
  batidas_impares: { label: 'Batidas em número ímpar', tone: 'danger' },
  interjornada_menor_11h: { label: 'Interjornada menor que 11 h', tone: 'danger' },
  extra_acima_2h: { label: 'Extra acima de 2 h', tone: 'danger' },
  intervalo_nao_cumprido: { label: 'Intervalo não cumprido', tone: 'danger' },
  marcacao_duplicada: { label: 'Marcação duplicada', tone: 'danger' },
  marcacao_fora_de_ordem: { label: 'Marcação fora de ordem', tone: 'danger' },
  marcacao_fora_da_escala: { label: 'Marcação fora da escala', tone: 'danger' },
};

export const RECALCULATE_SKIP_REASON: Record<RecalculateSkipReason, Label> = {
  sem_escala: { label: 'Sem escala vigente', tone: 'warn' },
};

export const DAY_RECALCULATE_SKIP_REASON: Record<DayRecalculateSkipReason, Label> = {
  sem_escala: { label: 'Sem escala vigente', tone: 'warn' },
  periodo_fechado: { label: 'Período fechado', tone: 'warn' },
};

export const TIME_BANK_MODALITY: Record<TimeBankModality, Label> = {
  individual_6m: { label: 'Acordo individual (6 meses)', tone: 'neutral' },
  coletivo_12m: { label: 'Acordo coletivo (12 meses)', tone: 'neutral' },
};

export const ADJUSTMENT_TYPE: Record<AdjustmentType, Label> = {
  inclusao_batida: { label: 'Inclusão de batida', tone: 'neutral' },
  justificativa: { label: 'Justificativa', tone: 'neutral' },
  abono: { label: 'Abono', tone: 'neutral' },
};

export const ADJUSTMENT_STATUS: Record<AdjustmentStatus, Label> = {
  pendente: { label: 'Pendente', tone: 'warn' },
  aprovado: { label: 'Aprovado', tone: 'good' },
  recusado: { label: 'Recusado', tone: 'danger' },
};

export const MANUAL_ABSENCE_TYPE: Record<ManualAbsenceType, Label> = {
  maternidade: { label: 'Licença-maternidade', tone: 'neutral' },
  paternidade: { label: 'Licença-paternidade', tone: 'neutral' },
  casamento: { label: 'Casamento', tone: 'neutral' },
  obito: { label: 'Óbito', tone: 'neutral' },
  doacao_sangue: { label: 'Doação de sangue', tone: 'neutral' },
  alistamento: { label: 'Alistamento', tone: 'neutral' },
  inss: { label: 'INSS', tone: 'neutral' },
  outro: { label: 'Outro', tone: 'neutral' },
};

export const CERTIFICATE_STATUS: Record<CertificateStatus, Label> = {
  pendente: { label: 'Pendente', tone: 'warn' },
  aprovado: { label: 'Aprovado', tone: 'good' },
  recusado: { label: 'Recusado', tone: 'danger' },
};

export const ANALYSIS_PROVIDER: Record<AnalysisProvider, Label> = {
  regras: { label: 'Regras', tone: 'neutral' },
  mock: { label: 'Mock (teste)', tone: 'neutral' },
  anthropic: { label: 'Anthropic', tone: 'neutral' },
  openai_compativel: { label: 'OpenAI compatível', tone: 'neutral' },
};

export const FINDING_SEVERITY: Record<FindingSeverity, Label> = {
  alta: { label: 'Alta', tone: 'danger' },
  media: { label: 'Média', tone: 'warn' },
  baixa: { label: 'Baixa', tone: 'neutral' },
};

export const AI_STATUS: Record<AiStatus, Label> = {
  concluida: { label: 'Concluída', tone: 'good' },
  nao_executada: { label: 'Não executada', tone: 'neutral' },
  falhou: { label: 'Falhou', tone: 'danger' },
};

export const AI_FAILURE: Record<AiFailure, Label> = {
  saida_fora_do_schema: { label: 'Resposta fora do formato', tone: 'danger' },
  provedor_indisponivel: { label: 'Provedor indisponível', tone: 'danger' },
  tempo_esgotado: { label: 'Tempo esgotado', tone: 'danger' },
  recusa_do_modelo: { label: 'Recusa do modelo', tone: 'danger' },
  saida_truncada: { label: 'Saída truncada', tone: 'danger' },
  dados_pessoais_no_envio: { label: 'Dados pessoais no envio', tone: 'danger' },
};

export const RECOMMENDATION: Record<Recommendation, Label> = {
  revisar_manual: { label: 'Revisar manualmente', tone: 'warn' },
  sem_recomendacao: { label: 'Sem recomendação', tone: 'neutral' },
};

export const FIELD_ITEM: Record<FieldItem, Label> = {
  data_atestado: { label: 'Data do atestado', tone: 'neutral' },
  periodo_afastamento: { label: 'Período do afastamento', tone: 'neutral' },
  profissional: { label: 'Profissional', tone: 'neutral' },
  legibilidade: { label: 'Legibilidade', tone: 'neutral' },
};

export const FIELD_STATUS: Record<FieldStatus, Label> = {
  ok: { label: 'OK', tone: 'good' },
  ausente: { label: 'Ausente', tone: 'warn' },
  incoerente: { label: 'Incoerente', tone: 'danger' },
  ilegivel: { label: 'Ilegível', tone: 'warn' },
};

export const CID_STATUS: Record<CidStatus, Label> = {
  valido: { label: 'Válido', tone: 'good' },
  fora_da_tabela: { label: 'Fora da tabela', tone: 'warn' },
};

export const CID_SOURCE: Record<CidSource, Label> = {
  regra: { label: 'Regra', tone: 'neutral' },
  ia: { label: 'IA', tone: 'neutral' },
};

export const RISK_LEVEL: Record<RiskLevel, Label> = {
  baixo: { label: 'Baixo', tone: 'good' },
  medio: { label: 'Médio', tone: 'warn' },
  alto: { label: 'Alto', tone: 'danger' },
};

export const RELIABILITY_BAND: Record<ReliabilityBand, Label> = {
  alta: { label: 'Alta', tone: 'good' },
  media: { label: 'Média', tone: 'warn' },
  baixa: { label: 'Baixa', tone: 'danger' },
};

export const VACATION_STATUS: Record<VacationStatus, Label> = {
  solicitada: { label: 'Solicitada', tone: 'warn' },
  aprovada: { label: 'Aprovada', tone: 'good' },
  recusada: { label: 'Recusada', tone: 'danger' },
  cancelada: { label: 'Cancelada', tone: 'neutral' },
  gozada: { label: 'Gozada', tone: 'good' },
};

export const CLOSING_STATUS: Record<ClosingStatus, Label> = {
  aberto: { label: 'Aberto', tone: 'warn' },
  fechado: { label: 'Fechado', tone: 'good' },
  reaberto: { label: 'Reaberto', tone: 'warn' },
};

export const TREND: Record<Trend, Label> = {
  up: { label: 'Alta', tone: 'neutral' },
  down: { label: 'Queda', tone: 'neutral' },
};

export const TONE: Record<Tone, Label> = {
  good: { label: 'Positivo', tone: 'good' },
  warn: { label: 'Atenção', tone: 'warn' },
  neutral: { label: 'Neutro', tone: 'neutral' },
};

// ---- [MOCK] enums sem back ----

export const DEVICE_CONNECTION: Record<DeviceConnection, Label> = {
  online: { label: 'Online', tone: 'good' },
  offline: { label: 'Offline', tone: 'neutral' },
  inativo: { label: 'Inativo', tone: 'neutral' },
};

export const CALIBRATION_STATE: Record<CalibrationState, Label> = {
  calibrado: { label: 'Calibrado', tone: 'good' },
  padrao: { label: 'Padrão', tone: 'neutral' },
  desatualizado: { label: 'Desatualizado', tone: 'warn' },
};

export const REPORT_TYPE: Record<ReportType, Label> = {
  horas_extras: { label: 'Horas extras', tone: 'neutral' },
  faltas: { label: 'Faltas', tone: 'neutral' },
  banco_horas: { label: 'Banco de horas', tone: 'neutral' },
  ferias: { label: 'Férias', tone: 'neutral' },
  afastamentos: { label: 'Afastamentos', tone: 'neutral' },
};

export const DAY_SITUATION: Record<DaySituation, Label> = {
  normal: { label: 'Normal', tone: 'neutral' },
  falta: { label: 'Falta', tone: 'warn' },
  folga: { label: 'Folga', tone: 'neutral' },
  feriado: { label: 'Feriado', tone: 'neutral' },
  ferias: { label: 'Férias', tone: 'neutral' },
  afastamento: { label: 'Afastamento', tone: 'neutral' },
};

/** `situation` vem como string do back: valor desconhecido aparece como veio, em tom neutro. */
export const daySituationLabel = (situation: string): Label =>
  (DAY_SITUATION as Record<string, Label | undefined>)[situation] ?? { label: situation, tone: 'neutral' };
