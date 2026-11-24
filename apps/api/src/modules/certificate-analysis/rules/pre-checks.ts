/**
 * Verificações determinísticas, ANTES da IA (RF62, RF63, RF64, RF65). Duplicidade
 * barra a chamada à IA: não faz sentido gastar nem enviar dado de saúde de um
 * atestado que já está registrado. Nenhuma regra recusa o atestado: só sinaliza.
 */
import { addDays, diffDays, rangesOverlap, type CivilDate } from '../../rules-common/rules/civil-time';
import type { TextFacts } from './text-facts';
import { UFS } from './text-facts';
import type { FindingCode } from './weights';

export interface CertificateFacts {
  id: number;
  startDate: CivilDate;
  days: number | null;
  hours: number | null;
  doctorCrm: string | null;
  doctorCrmUf: string | null;
  /** Data (no fuso do estabelecimento) em que o colaborador enviou. */
  sentDate: CivilDate;
}

export interface OtherCertificate {
  id: number;
  startDate: CivilDate;
  days: number | null;
  hours: number | null;
  status: string;
  doctorCrm: string | null;
  doctorCrmUf: string | null;
}

export type Severity = 'alta' | 'media' | 'baixa';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
}

export interface PreCheckInput {
  certificate: CertificateFacts;
  /** Outros atestados do mesmo colaborador (qualquer status). */
  others: readonly OtherCertificate[];
  /** Fatos lidos do texto (anonimizado). */
  text: TextFacts;
  /** Prazo de envio em dias (`dias_prazo_atestado`); null = parâmetro não cadastrado, não avalia. */
  deadlineDays: number | null;
  /** Quantas ocorrências de CPF e nome saíram do texto antes do envio. */
  removedPersonalData: number;
}

export interface PreCheckResult {
  findings: Finding[];
  /** true = não chama a IA (duplicidade). */
  blocksAi: boolean;
  /** Verificações que não rodaram e por quê (ex.: prazo sem parâmetro). */
  skipped: string[];
}

const lastDay = (c: { startDate: CivilDate; days: number | null }) => (c.days ? addDays(c.startDate, c.days - 1) : c.startDate);

export function runPreChecks(input: PreCheckInput): PreCheckResult {
  const { certificate: c, text } = input;
  const findings: Finding[] = [];
  const skipped: string[] = [];

  // RF64: mesmo período, ou mesmo médico na mesma data, em outro atestado ainda válido.
  const duplicate = input.others.find(
    (o) =>
      o.id !== c.id &&
      o.status !== 'recusado' &&
      (rangesOverlap(c.startDate, lastDay(c), o.startDate, lastDay(o)) ||
        (o.startDate === c.startDate && c.doctorCrm !== null && o.doctorCrm === c.doctorCrm && o.doctorCrmUf === c.doctorCrmUf)),
  );
  if (duplicate) {
    findings.push({
      code: 'atestado_duplicado',
      severity: 'alta',
      message: `Já existe o atestado ${duplicate.id} para o mesmo período ou o mesmo médico e data. A IA não foi chamada.`,
    });
  }

  // RF63: CRM só em formato (UF válida + número). Não há consulta a base externa.
  const declaredCrmBad = c.doctorCrm !== null && (!/^\d{3,8}$/.test(c.doctorCrm) || (c.doctorCrmUf !== null && !UFS.has(c.doctorCrmUf)));
  const textCrmBad = text.crm !== null && !text.crm.wellFormed;
  const crmMismatch =
    text.crm !== null && text.crm.wellFormed && c.doctorCrm !== null && text.crm.number !== c.doctorCrm;
  if (declaredCrmBad || textCrmBad || crmMismatch) {
    findings.push({
      code: 'crm_invalido',
      severity: 'media',
      message: crmMismatch
        ? 'O CRM do texto não bate com o CRM informado no envio.'
        : 'O CRM não tem formato válido (UF + número). Só o formato é conferido.',
    });
  }

  // RF62: dias e início lidos do texto × informados no envio.
  const textDays = text.days?.value ?? (text.range ? diffDays(text.range.start, text.range.end) + 1 : null);
  const daysDiverge = c.days !== null && textDays !== null && textDays !== c.days;
  const startDiverges = text.range !== null && text.range.start !== c.startDate;
  if (daysDiverge || startDiverges) {
    findings.push({
      code: 'datas_divergentes',
      severity: 'media',
      message: 'O período lido no texto não bate com o início ou os dias informados no envio.',
    });
  }

  // RF65: prazo de envio, só com parâmetro cadastrado.
  if (input.deadlineDays === null) {
    skipped.push('enviado_fora_do_prazo: parâmetro dias_prazo_atestado não cadastrado');
  } else if (diffDays(c.startDate, c.sentDate) > input.deadlineDays) {
    findings.push({
      code: 'enviado_fora_do_prazo',
      severity: 'baixa',
      message: `Enviado ${diffDays(c.startDate, c.sentDate)} dias depois do início; o prazo é de ${input.deadlineDays} dias.`,
    });
  }

  if (input.removedPersonalData > 0) {
    findings.push({
      code: 'dados_pessoais_no_texto',
      severity: 'baixa',
      message: 'CPF ou nome do colaborador foram removidos do texto antes da análise.',
    });
  }

  return { findings, blocksAi: duplicate !== undefined, skipped };
}
