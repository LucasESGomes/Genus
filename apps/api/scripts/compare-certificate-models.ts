/**
 * pnpm --filter @genus/api rh:compare-ai -- [--models mock:v1,mock:estrito,anthropic:claude-haiku-5-5]
 *
 * Roda a MESMA entrada em dois ou mais modelos e gera o relatório de comparação
 * (concordância por campo, divergências, tempo de resposta e acerto contra o
 * gabarito) em apps/api/reports/ia-atestados/ (fora do Git).
 *
 * Sem --certificate: usa os atestados SINTÉTICOS de test/fixtures (com gabarito).
 * Nada é gravado no banco.
 *
 * Com --certificate <id> --tenant <id> --user <id do usuário rh> --text-file <arquivo>:
 * analisa um atestado pendente real e grava uma linha por modelo em
 * rh.analises_atestado (RH_DATABASE_URL de apps/api/.env.dev). O texto do arquivo
 * é dado de saúde: não saia com ele do ambiente e apague depois.
 *
 * Provedores e chaves vêm do ambiente (CERTIFICATE_AI_*); sem eles, só a mock.
 * O relatório não traz texto do atestado nem CID.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLogger, SystemClock } from '@genus/shared';
import { and, eq } from 'drizzle-orm';
import { loadCertificateAiEnv } from '../src/config/env';
import { createDatabase } from '../src/db/client';
import { users } from '../src/db/schema';
import { CertificateAiRegistry } from '../src/modules/certificate-analysis/ai/registry';
import { buildComparison, renderComparisonMarkdown, type CaseRun } from '../src/modules/certificate-analysis/compare';
import { HealthDataCipher } from '../src/modules/certificate-analysis/health-crypto';
import { runAnalysis, type AnalysisOutcome } from '../src/modules/certificate-analysis/pipeline';
import { CertificateAnalysisService } from '../src/modules/certificate-analysis/service';
import { SYNTHETIC_CERTIFICATES } from '../test/fixtures/certificates/synthetic';

const out = (line = '') => process.stdout.write(`${line}\n`);
const fail = (msg: string): never => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

const { values } = parseArgs({
  // pnpm repassa o `--` separador: fica de fora.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    models: { type: 'string' },
    certificate: { type: 'string' },
    tenant: { type: 'string' },
    user: { type: 'string' },
    'text-file': { type: 'string' },
    out: { type: 'string' },
  },
});

const { certificateAi, certificateDataKeyHex } = loadCertificateAiEnv();
const registry = new CertificateAiRegistry(certificateAi);
const models = values.models ? values.models.split(',').map((m) => m.trim()).filter(Boolean) : registry.available();
if (models.length < 2) fail('Informe dois ou mais modelos em --models (ex.: mock:v1,mock:estrito)');
const resolved = models.map((m) => {
  try {
    return { spec: m, ...registry.resolve(m) };
  } catch (err) {
    return fail(`Modelo ${m}: ${(err as Error).message}`);
  }
});

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(values.out ?? join(here, '..', 'reports', 'ia-atestados'));
const clock = new SystemClock();

async function synthetic(): Promise<CaseRun[]> {
  const runs: CaseRun[] = [];
  for (const c of SYNTHETIC_CERTIFICATES) {
    const outcomes: Record<string, AnalysisOutcome> = {};
    for (const r of resolved) {
      outcomes[r.spec] = await runAnalysis(
        { text: c.text, person: c.person, certificate: { id: 0, ...c.declared }, others: c.others ?? [], deadlineDays: null },
        r,
      );
    }
    runs.push({ caseId: c.id, expected: c.expected, outcomes });
  }
  return runs;
}

async function real(): Promise<CaseRun[]> {
  const certificateId = Number(values.certificate);
  const tenantId = Number(values.tenant);
  const userId = Number(values.user);
  if (![certificateId, tenantId, userId].every((n) => Number.isSafeInteger(n) && n > 0)) {
    fail('Com --certificate, informe também --tenant e --user (ids inteiros) e --text-file');
  }
  if (!values['text-file']) fail('Informe --text-file com o texto extraído do atestado');
  const url = process.env.RH_DATABASE_URL ?? fail('RH_DATABASE_URL é obrigatória no modo --certificate (pnpm setup:dev)');
  const logger = createLogger({ level: 'warn', service: 'compare-ai' });
  const database = createDatabase(url, logger, 2);
  try {
    const [user] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.role, 'rh')))
      .limit(1);
    if (!user) fail('O --user precisa ser um usuário rh da conta informada');
    const service = new CertificateAnalysisService({
      db: database.db,
      clock,
      ai: registry,
      healthCipher: HealthDataCipher.fromHex(certificateDataKeyHex),
      logger,
    });
    const ctx = { tenantId, userId, employeeId: null, role: 'rh' as const, sessionId: 0, establishmentScope: null, via: 'cookie' as const };
    const text = readFileSync(values['text-file']!, 'utf8');
    const { result, outcomes } = await service.analyzeDetailed(ctx, certificateId, { text, models });
    out(`Gravadas ${result.analyses.length} análise(s) em rh.analises_atestado: ${result.analyses.map((a) => `#${a.id} ${a.provider}:${a.model}`).join(', ')}`);
    return [{ caseId: `atestado-${certificateId}`, outcomes: Object.fromEntries(outcomes.map((o, i) => [models[i]!, o])) }];
  } finally {
    await database.close();
  }
}

const runs = values.certificate ? await real() : await synthetic();
const report = buildComparison(runs, clock.now());
mkdirSync(outDir, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const mdPath = join(outDir, `comparativo-${stamp}.md`);
writeFileSync(mdPath, renderComparisonMarkdown(report));
writeFileSync(join(outDir, `comparativo-${stamp}.json`), JSON.stringify(report, null, 2));

out(`Modelos: ${report.models.join(', ')} · ${report.cases} atestado(s) ${values.certificate ? 'real' : 'sintéticos'}`);
for (const s of report.summaries) {
  const acc = s.overallAccuracy === null ? 'sem gabarito' : `acerto ${Math.round(s.overallAccuracy * 100)}%`;
  out(`  ${s.model}: ${acc}, falhas ${s.failures}, tempo médio ${s.avgMs ?? '—'} ms${s.warnings.length ? `, avisos ${s.warnings.join(', ')}` : ''}`);
}
out(`Concordância: ${Object.entries(report.agreementByField).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}`);
out(`Divergências: ${report.divergences.length}`);
out(`Relatório: ${mdPath}`);
