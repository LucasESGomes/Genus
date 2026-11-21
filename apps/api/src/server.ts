/**
 * Ponto de entrada: carrega o ambiente (falha ao subir se algo faltar), monta
 * as dependências reais e abre a porta. As variáveis vêm do processo
 * (`--env-file` do tsx em dev; ambiente do Compose no contêiner).
 */
import { buildApp } from './app';
import { EnvError, loadEnv, type Env } from './config/env';
import { createContainer } from './container';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) fail(err.message);
    throw err;
  }

  const container = createContainer(env);
  const app = await buildApp(container.appDeps);
  const shutdown = async (signal: string): Promise<void> => {
    container.logger.info({ signal }, 'encerrando');
    await app.close();
    await container.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.port, host: '0.0.0.0' });
  container.logger.info({ port: env.port, appEnv: env.appEnv }, 'api do portal no ar');
}

main().catch((err: unknown) => {
  process.stderr.write(`Falha ao subir: ${err instanceof Error ? err.message : 'erro desconhecido'}\n`);
  process.exit(1);
});
