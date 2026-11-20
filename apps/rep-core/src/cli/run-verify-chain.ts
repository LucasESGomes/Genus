import pg from 'pg';
import { z } from 'zod';
import { checkProcessedInvariant } from '../nsr/check-invariant.js';
import { readChain } from '../nsr/read-chain.js';
import { verifyChain } from '../nsr/verify-chain.js';

/** 0 = cadeia e invariante íntegros; 1 = problema encontrado; 2 = erro de uso ou configuração. */
export type VerifyChainExitCode = 0 | 1 | 2;

export interface RunVerifyChainDeps {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Injetável para teste; o padrão cria um Pool do `pg`. */
  createPool?: (connectionString: string) => pg.Pool;
}

const envSchema = z.object({
  ARP_READER_DATABASE_URL: z.string().min(1),
});

const idSchema = z.coerce.number().int().positive().safe();

const USAGE = 'Uso: pnpm arp:verify-chain -- --establishment <id> --tenant <id>';

function parseArgs(argv: readonly string[]): { tenant?: string; establishment?: string } {
  const out: { tenant?: string; establishment?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--tenant') out.tenant = argv[++i];
    else if (a === '--establishment') out.establishment = argv[++i];
    else if (a?.startsWith('--tenant=')) out.tenant = a.slice('--tenant='.length);
    else if (a?.startsWith('--establishment=')) out.establishment = a.slice('--establishment='.length);
    else throw new Error(`Argumento desconhecido: ${String(a)}`);
  }
  return out;
}

const MAX_LISTED = 20;

/**
 * Verifica a cadeia de hash e o invariante "processado => registro + evidência + 3 eventos"
 * de um estabelecimento (SPEC §2, item 5). Nunca imprime a URL de conexão nem CPF.
 */
export async function runVerifyChain(deps: RunVerifyChainDeps): Promise<VerifyChainExitCode> {
  let tenantId: number;
  let establishmentId: number;
  try {
    const args = parseArgs(deps.argv);
    tenantId = idSchema.parse(args.tenant);
    establishmentId = idSchema.parse(args.establishment);
  } catch {
    deps.err('Argumentos inválidos: --tenant e --establishment são obrigatórios (inteiros positivos).');
    deps.err(USAGE);
    return 2;
  }

  const env = envSchema.safeParse(deps.env);
  if (!env.success) {
    deps.err('Configuração inválida: defina ARP_READER_DATABASE_URL no ambiente.');
    return 2;
  }

  const pool = (deps.createPool ?? ((cs) => new pg.Pool({ connectionString: cs, max: 2 })))(
    env.data.ARP_READER_DATABASE_URL,
  );
  try {
    const rows = await readChain(pool, { tenantId, establishmentId });
    const report = verifyChain(rows);
    const problems = await checkProcessedInvariant(pool, { tenantId, establishmentId });

    deps.out(`Conta ${tenantId}, estabelecimento ${establishmentId}`);
    deps.out(`Linhas verificadas: ${report.rowsChecked}`);
    deps.out(`Último NSR: ${report.lastNsr}`);
    deps.out(`Último hash: ${report.rowsChecked === 0 ? '(cadeia vazia)' : report.lastHash.toString('hex')}`);
    deps.out(`Erros de cadeia: ${report.errors.length}`);
    for (const e of report.errors.slice(0, MAX_LISTED)) deps.out(`  ERRO: ${e}`);
    if (report.errors.length > MAX_LISTED) deps.out(`  ... e mais ${report.errors.length - MAX_LISTED}`);
    deps.out(`Avisos: ${report.warnings.length}`);
    for (const w of report.warnings.slice(0, MAX_LISTED)) deps.out(`  AVISO: ${w}`);
    deps.out(`Problemas de invariante (entradas processadas): ${problems.length}`);
    for (const p of problems.slice(0, MAX_LISTED)) deps.out(`  PROBLEMA: entrada ${p.entryId}: ${p.reason}`);

    const ok = report.ok && problems.length === 0;
    deps.out(ok ? 'Resultado: ÍNTEGRO' : 'Resultado: PROBLEMAS ENCONTRADOS');
    return ok ? 0 : 1;
  } catch (e) {
    // Mensagem do driver pode citar host/porta, mas nunca a senha; ainda assim só o código.
    const code = (e as { code?: string }).code;
    deps.err(`Falha ao consultar o banco${code ? ` (${code})` : ''}.`);
    return 2;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
