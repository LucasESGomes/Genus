/**
 * pnpm rh:check-arp
 *
 * Confere se toda referência do banco arp (conta, estabelecimento, aparelho,
 * colaborador, CPF) existe no cadastro do RH com os mesmos dados. Só leitura.
 * Lê ARP_READER_DATABASE_URL e RH_DATABASE_URL de apps/api/.env.dev.
 * Sai com código 1 se houver divergência. CPF sai mascarado.
 */
import { maskCpf } from '@genus/shared';
import { checkArp } from '../src/arp/check-arp';

const out = (line = '') => process.stdout.write(`${line}\n`);

const arpUrl = process.env.ARP_READER_DATABASE_URL;
const rhUrl = process.env.RH_DATABASE_URL;
if (!arpUrl || !rhUrl) {
  process.stderr.write('ARP_READER_DATABASE_URL e RH_DATABASE_URL são obrigatórias (pnpm setup:dev)\n');
  process.exit(1);
}

checkArp(arpUrl, rhUrl)
  .then((findings) => {
    if (findings.length === 0) {
      out('arp x RH: nenhuma divergência. Toda referência do arp existe no cadastro do RH.');
      return;
    }
    out(`arp x RH: ${findings.length} divergência(s)`);
    for (const f of findings) {
      const parts = [`conta ${f.tenantId}`];
      if (f.establishmentId !== undefined) parts.push(`estabelecimento ${f.establishmentId}`);
      if (f.deviceId !== undefined) parts.push(`aparelho ${f.deviceId}`);
      if (f.employeeId !== undefined) parts.push(`colaborador ${f.employeeId}`);
      if (f.cpf !== undefined) parts.push(`cpf ${maskCpf(f.cpf)}`);
      out(`  - ${f.type}: ${parts.join(', ')}`);
    }
    process.exitCode = 1;
  })
  .catch((err: unknown) => {
    const e = err as { name?: string; code?: string };
    process.stderr.write(`Falha na conferência: ${e.name ?? 'Error'} ${e.code ?? ''}\n`);
    process.exit(1);
  });
