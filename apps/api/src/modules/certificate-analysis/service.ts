/**
 * Análise de atestado (G6, RF61–RF67, RN15). Só o RH dispara e lê.
 *
 * - Só atestado `pendente`: já decidido → 409. A análise NUNCA altera o atestado
 *   (nenhum UPDATE em `rh.atestados` aqui): a IA sugere, o RH decide (G7).
 * - Uma linha em `analises_atestado` por modelo, com provedor, modelo, versão do
 *   prompt e hash da entrada. Dado de saúde (texto, CID, evidências) só cifrado;
 *   sem `CERTIFICATE_DATA_KEY`, não é gravado e a resposta avisa.
 * - Falha da IA (fora do schema, rede, tempo, recusa) é tratada: a análise das
 *   regras é gravada, nada da IA entra, e a recomendação é `revisar_manual`.
 * - Nada do conteúdo do atestado vai para log nem para a auditoria.
 */
import type { Clock } from '@genus/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { certificateAnalyses, medicalCertificates } from '../../db/schema';
import { notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope, type EmployeeRecord } from '../employees/lookup';
import { loadLegalParameters } from '../legal-parameters/repository';
import { ParameterReader } from '../legal-parameters/rules/resolve';
import { PARAM } from '../legal-parameters/rules/keys';
import { RhDomainError } from '../rules-common/rules/errors';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import { buildComparison } from './compare';
import { HealthDataCipher, type HealthColumn } from './health-crypto';
import { CertificateAiRegistry, UnknownModelError, type ResolvedProvider } from './ai/registry';
import type { CidCandidate } from './rules/cid';
import type { Finding } from './rules/pre-checks';
import { ANALYSIS_NOTICE, RULES_VERSION } from './rules/weights';
import { runAnalysis, type AnalysisOutcome } from './pipeline';
import type { AnalysisDto } from './schemas';
import type { AiOutput } from './ai/output-schema';

export interface CertificateAnalysisDeps {
  db: Database;
  clock: Clock;
  ai: CertificateAiRegistry;
  /** null = sem chave: análise roda, dado de saúde não é gravado. */
  healthCipher: HealthDataCipher | null;
  /** Só metadados (id, provedor, código da falha). Nunca o texto. */
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
}

/** Resumo gravado em `resultado`: sem texto livre do atestado. */
interface StoredSummary {
  rulesVersion: string;
  aiStatus: AnalysisOutcome['ai']['status'];
  discardedEvidence: number;
  warnings: string[];
  skippedChecks: string[];
  findings: Finding[];
  reliability: AnalysisOutcome['reliability'];
  checkedFields?: { item: AiOutput['checkedFields'][number]['item']; status: AiOutput['checkedFields'][number]['status'] }[];
  possibilities: AiOutput['possibilities'];
}

type Row = typeof certificateAnalyses.$inferSelect;

export const SEM_CHAVE = 'SEM_CHAVE_DADOS_SAUDE';

export class CertificateAnalysisService {
  constructor(private readonly d: CertificateAnalysisDeps) {}

  private async loadCertificate(ctx: RequestContext, id: number) {
    const [row] = await this.d.db
      .select()
      .from(medicalCertificates)
      .where(and(eq(medicalCertificates.tenantId, tenantOf(ctx)), eq(medicalCertificates.id, id)))
      .limit(1);
    if (!row) throw notFound('Atestado');
    const emp = await findEmployeeInScope(this.d.db, ctx, row.employeeId).catch(() => {
      throw notFound('Atestado');
    });
    return { row, emp };
  }

  /** Prazo de envio (`dias_prazo_atestado`), se cadastrado. Sem parâmetro: null (a regra não avalia). */
  private async deadlineDays(emp: EmployeeRecord, date: string): Promise<number | null> {
    const rows = await loadLegalParameters(this.d.db, emp.tenantId, emp.companyId);
    try {
      return new ParameterReader(rows, date, { companyId: String(emp.companyId) }).int(PARAM.certificateDeadlineDays);
    } catch (err) {
      if (err instanceof RhDomainError && err.code === 'PARAMETRO_AUSENTE') return null;
      throw err;
    }
  }

  private resolveProviders(models: string[] | undefined): ResolvedProvider[] {
    if (!models) return [this.d.ai.default()];
    try {
      return models.map((m) => this.d.ai.resolve(m));
    } catch (err) {
      if (err instanceof UnknownModelError) {
        throw new HttpError(400, 'MODELO_IA_INVALIDO', err.message, [{ path: 'models', message: err.message }]);
      }
      throw err;
    }
  }

  async analyze(ctx: RequestContext, id: number, body: { text: string; models?: string[] }) {
    return (await this.analyzeDetailed(ctx, id, body)).result;
  }

  /** Igual a `analyze`, devolvendo também os resultados completos (comando de comparação). */
  async analyzeDetailed(ctx: RequestContext, id: number, body: { text: string; models?: string[] }) {
    const { row, emp } = await this.loadCertificate(ctx, id);
    if (row.status !== 'pendente') throw new HttpError(409, 'STATUS_INVALIDO', 'O atestado já foi decidido; a análise é só para atestado pendente');
    const providers = this.resolveProviders(body.models);

    const tz = timezoneForUf(emp.uf);
    const sentDate = toCivilDate(row.sentAt, tz);
    const others = await this.d.db
      .select({
        id: medicalCertificates.id,
        startDate: medicalCertificates.startDate,
        days: medicalCertificates.days,
        hours: medicalCertificates.hours,
        status: medicalCertificates.status,
        doctorCrm: medicalCertificates.doctorCrm,
        doctorCrmUf: medicalCertificates.doctorCrmUf,
      })
      .from(medicalCertificates)
      .where(
        and(
          eq(medicalCertificates.tenantId, emp.tenantId),
          eq(medicalCertificates.employeeId, emp.id),
          ne(medicalCertificates.id, id),
        ),
      );
    const input = {
      text: body.text,
      person: { cpf: emp.cpf, name: emp.name },
      certificate: {
        id,
        startDate: row.startDate,
        days: row.days,
        hours: row.hours,
        doctorCrm: row.doctorCrm,
        doctorCrmUf: row.doctorCrmUf,
        sentDate,
      },
      others,
      deadlineDays: await this.deadlineDays(emp, row.startDate),
    };

    const outcomes: AnalysisOutcome[] = [];
    for (const p of providers) {
      const outcome = await runAnalysis(input, p);
      outcomes.push(outcome);
      // Barrada pelas regras: os outros modelos dariam o mesmo resultado, uma linha basta.
      if (outcome.provider === 'regras') break;
    }

    const analyzedAt = this.d.clock.now();
    const saved = await this.d.db.transaction(async (tx) => {
      const out: { id: number; outcome: AnalysisOutcome }[] = [];
      for (const o of outcomes) {
        const enc = (column: HealthColumn, plain: string) =>
          this.d.healthCipher?.encrypt(plain, { tenantId: emp.tenantId, certificateId: id, column }) ?? null;
        const [inserted] = await tx
          .insert(certificateAnalyses)
          .values({
            tenantId: emp.tenantId,
            certificateId: id,
            ocrTextEnc: enc('ocr_texto_cifrado', o.redactedText),
            score: o.risk.score,
            riskLevel: o.risk.level,
            reasons: o.findings.map((f) => f.code),
            analyzedAt,
            provider: o.provider,
            model: o.model,
            promptVersion: o.provider === 'regras' ? null : o.promptVersion,
            inputHash: Buffer.from(o.inputHash, 'hex'),
            result: summary(o, this.d.healthCipher === null) as unknown as Record<string, unknown>,
            recommendation: o.recommendation,
            cidEnc: o.cid.length > 0 ? enc('cid_cifrado', JSON.stringify(o.cid)) : null,
            evidenceEnc: o.checkedFields.length > 0 ? enc('evidencias_cifradas', JSON.stringify(o.checkedFields.map((f) => ({ item: f.item, evidence: f.evidence })))) : null,
            responseMs: o.responseMs,
            failure: o.ai.failure,
          })
          .returning({ id: certificateAnalyses.id });
        out.push({ id: inserted!.id, outcome: o });
      }
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'atestados',
        entityId: id,
        action: 'criacao',
        // Só metadados: nada do texto, do CID nem das evidências.
        after: {
          event: 'certificate.analyzed',
          models: outcomes.map((o) => (o.model ? `${o.provider}:${o.model}` : o.provider)),
          recommendations: outcomes.map((o) => o.recommendation),
          analysisIds: out.map((x) => x.id),
        },
      });
      return out;
    });

    for (const o of outcomes) {
      if (o.ai.status === 'falhou') {
        this.d.logger?.warn({ certificateId: id, provider: o.provider, model: o.model, failure: o.ai.failure }, 'análise de atestado: falha tratada da IA');
      }
    }

    const keyWarning = this.d.healthCipher === null ? [SEM_CHAVE] : [];
    const analyses = saved.map(({ id: analysisId, outcome }) => outcomeDto(analysisId, id, analyzedAt, outcome, keyWarning));
    let comparison = null;
    if (saved.length > 1) {
      const models = saved.map(({ outcome }) => `${outcome.provider}:${outcome.model}`);
      const report = buildComparison([{ caseId: String(id), outcomes: Object.fromEntries(saved.map(({ outcome }, i) => [models[i]!, outcome])) }], analyzedAt);
      comparison = {
        agreementByField: report.agreementByField,
        divergences: report.divergences.map((d) => ({ field: d.field, values: d.values })),
        responseMs: Object.fromEntries(saved.map(({ outcome }, i) => [models[i]!, outcome.responseMs])),
      };
    }
    return { result: { certificateId: id, certificateStatus: row.status as 'pendente', analyses, comparison }, outcomes };
  }

  /** Análises do atestado, da mais nova para a mais antiga. Decifrar CID/evidências é leitura sensível auditada. */
  async list(ctx: RequestContext, id: number): Promise<AnalysisDto[]> {
    const { emp } = await this.loadCertificate(ctx, id);
    const rows = await this.d.db
      .select()
      .from(certificateAnalyses)
      .where(and(eq(certificateAnalyses.tenantId, emp.tenantId), eq(certificateAnalyses.certificateId, id)))
      .orderBy(desc(certificateAnalyses.analyzedAt), desc(certificateAnalyses.id));
    const decrypted = rows.some((r) => r.cidEnc || r.evidenceEnc);
    if (decrypted && this.d.healthCipher) {
      await recordAudit(this.d.db, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'atestados',
        entityId: id,
        action: 'leitura_sensivel',
        after: { event: 'certificate.analyses_read', analysisIds: rows.map((r) => r.id) },
      });
    }
    return rows.map((r) => rowDto(r, this.d.healthCipher));
  }
}

function summary(o: AnalysisOutcome, noKey: boolean): StoredSummary {
  const s: StoredSummary = {
    rulesVersion: o.rulesVersion,
    aiStatus: o.ai.status,
    discardedEvidence: o.ai.discardedEvidence,
    warnings: noKey ? [...o.warnings, SEM_CHAVE] : o.warnings,
    skippedChecks: o.skippedChecks,
    findings: o.findings,
    reliability: o.reliability,
    possibilities: o.possibilities,
  };
  if (o.ai.status === 'concluida') s.checkedFields = o.checkedFields.map((f) => ({ item: f.item, status: f.status }));
  return s;
}

function outcomeDto(id: number, certificateId: number, at: Date, o: AnalysisOutcome, extraWarnings: string[]): AnalysisDto {
  return {
    id,
    certificateId,
    provider: o.provider,
    model: o.model,
    promptVersion: o.provider === 'regras' ? null : o.promptVersion,
    rulesVersion: o.rulesVersion,
    inputHash: o.inputHash,
    analyzedAt: at.toISOString(),
    responseMs: o.responseMs,
    notice: o.notice,
    warnings: [...o.warnings, ...extraWarnings],
    recommendation: o.recommendation,
    ai: { status: o.ai.status, failure: o.ai.failure },
    checkedFields: o.checkedFields,
    possibilities: o.possibilities,
    cid: o.cid,
    risk: { score: o.risk.score, level: o.risk.level, findings: o.findings },
    reliability: o.reliability,
  };
}

function rowDto(r: Row, cipher: HealthDataCipher | null): AnalysisDto {
  const s = (r.result ?? {}) as unknown as Partial<StoredSummary>;
  const where = (column: HealthColumn) => ({ tenantId: r.tenantId, certificateId: r.certificateId, column });
  let cid: CidCandidate[] | null = null;
  let evidences: { item: string; evidence: string | null }[] = [];
  const warnings = [...(s.warnings ?? [])];
  if (cipher) {
    if (r.cidEnc) cid = JSON.parse(cipher.decrypt(r.cidEnc, where('cid_cifrado'))) as CidCandidate[];
    else cid = [];
    if (r.evidenceEnc) evidences = JSON.parse(cipher.decrypt(r.evidenceEnc, where('evidencias_cifradas'))) as typeof evidences;
  } else if (!warnings.includes(SEM_CHAVE)) {
    warnings.push(SEM_CHAVE);
  }
  return {
    id: r.id,
    certificateId: r.certificateId,
    provider: r.provider as AnalysisDto['provider'],
    model: r.model,
    promptVersion: r.promptVersion,
    rulesVersion: s.rulesVersion ?? RULES_VERSION,
    inputHash: r.inputHash ? r.inputHash.toString('hex') : null,
    analyzedAt: r.analyzedAt.toISOString(),
    responseMs: r.responseMs,
    notice: ANALYSIS_NOTICE,
    warnings,
    recommendation: r.recommendation as AnalysisDto['recommendation'],
    ai: { status: s.aiStatus ?? 'nao_executada', failure: (r.failure as AnalysisDto['ai']['failure']) ?? null },
    checkedFields: (s.checkedFields ?? []).map((f) => ({ ...f, evidence: evidences.find((e) => e.item === f.item)?.evidence ?? null })),
    possibilities: s.possibilities ?? [],
    cid,
    risk: { score: r.score, level: r.riskLevel as AnalysisDto['risk']['level'], findings: s.findings ?? [] },
    reliability: s.reliability ?? { score: 0, band: 'baixa', cap: 0 },
  };
}

