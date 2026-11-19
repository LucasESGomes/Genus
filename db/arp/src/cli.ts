import { migrate } from "./migrate";

const url = process.env["ARP_MIGRATION_DATABASE_URL"];
if (!url) {
  process.stderr.write("Erro: defina ARP_MIGRATION_DATABASE_URL (conexão do dono do banco arp).\n");
  process.exit(1);
}

try {
  const { applied, skipped } = await migrate(url);
  for (const f of applied) process.stdout.write(`aplicada: ${f}\n`);
  for (const f of skipped) process.stdout.write(`já aplicada: ${f}\n`);
  process.stdout.write(`${applied.length} aplicada(s), ${skipped.length} já existente(s).\n`);
} catch (err) {
  process.stderr.write(`Falha na migration: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
