/**
 * Monta as dependências reais a partir do ambiente. Os testes usam o mesmo
 * container, trocando só logger e relógio.
 */
import { createLogger, SystemClock, type Clock, type Logger } from '@genus/shared';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { createDatabase, type DatabaseHandle } from './db/client';
import { createAuth } from './modules/auth/auth';
import pg from 'pg';
import { PgArpPunchReader } from './arp/punch-reader';
import { PortalAccess } from './http/access';
import { CertificateAiRegistry } from './modules/certificate-analysis/ai/registry';
import { HealthDataCipher } from './modules/certificate-analysis/health-crypto';
import { HttpFacialEngineClient } from './modules/facial/engine-client';
import { deriveInviteCpfKey } from './modules/invites/crypto';
import { LocalDiskStorage } from './storage/file-storage';
import { PgArpOpsReader } from './arp/ops-reader';
import { PgRecognitionStatsReader } from './arp/recognition-reader';
import { deriveEmailHashKey } from './modules/super-admin/access-logs/email-hash';
import { ValkeyQueueInspector } from './modules/super-admin/system-health/queue-inspector';

/** Versão exibida na saúde dos sistemas (sem segredo). APP_VERSION vem do deploy; padrão = pacote. */
const API_VERSION = process.env.APP_VERSION ?? '0.0.0';

export interface Container {
  appDeps: AppDeps;
  logger: Logger;
  clock: Clock;
  database: DatabaseHandle;
  close(): Promise<void>;
}

export function createContainer(env: Env, overrides: { logger?: Logger; clock?: Clock } = {}): Container {
  const logger = overrides.logger ?? createLogger({ level: env.logLevel, service: 'api' });
  const clock = overrides.clock ?? new SystemClock();
  const database = createDatabase(env.databaseUrl, logger, env.databasePoolMax);
  const auth = createAuth(
    database.db,
    {
      secret: env.authSecret,
      baseURL: env.authBaseUrl,
      trustedOrigins: env.corsOrigins,
      secureCookies: env.appEnv !== 'dev',
    },
    logger,
  );

  // Banco arp: só leitura (papel arp_reader). Pool pequeno: a apuração lê por colaborador e dia.
  const arpPool = new pg.Pool({ connectionString: env.arpReaderDatabaseUrl, max: 4 });
  arpPool.on('error', (err) => {
    logger.error({ err: { name: err.name, code: (err as { code?: string }).code } }, 'pg arp: erro em conexão ociosa');
  });
  const pinPepper = { version: env.pinPepper.version, key: Buffer.from(env.pinPepper.keyHex, 'hex') };
  const inviteCpfHashKey = deriveInviteCpfKey(env.authSecret);

  // Análise de atestado (G6): avisa na partida se a IA é a simulada ou se falta a chave do dado de saúde.
  const certificateAi = new CertificateAiRegistry(env.certificateAi);
  const ai = certificateAi.default();
  if (ai.warnings.length > 0) logger.warn({ provider: ai.provider.provider, model: ai.provider.model }, 'análise de atestado: IA simulada (mock), sem provedor real configurado');
  if (env.certificateDataKeyHex === null) logger.warn('análise de atestado: sem CERTIFICATE_DATA_KEY, CID, texto e evidências não serão gravados');

  // Painel do super_admin: leituras do arp (mesmo pool somente leitura), Valkey (só leitura de contagens) e probes HTTP.
  const queues = env.valkeyUrl ? new ValkeyQueueInspector({ url: env.valkeyUrl, clock, logger }) : null;
  if (env.appEnv === 'prod') {
    if (!env.masterKeyHex) logger.warn('super_admin: sem MASTER_KEY, o painel não cria empresas (503 MASTER_KEY_AUSENTE)');
    if (!env.valkeyUrl) logger.warn('super_admin: sem VALKEY_URL, a saúde de fila, rep-core e jobs fica parcial');
    if (!env.collectorApiUrl) logger.warn('super_admin: sem COLLECTOR_API_URL, a saúde da api do coletor não é consultada');
  }

  return {
    logger,
    clock,
    database,
    appDeps: {
      logger,
      pool: database.pool,
      db: database.db,
      corsOrigins: env.corsOrigins,
      apiDocs: env.appEnv === 'dev',
      auth: { auth, baseURL: env.authBaseUrl, clock, emailHashKey: deriveEmailHashKey(env.authSecret) },
      portal: {
        db: database.db,
        clock,
        access: new PortalAccess(env.gestorEnabled),
        arp: new PgArpPunchReader(arpPool),
        storage: new LocalDiskStorage(env.attachmentsDir),
        engine: env.engine ? new HttpFacialEngineClient({ baseUrl: env.engine.url, apiKey: env.engine.apiKey }) : null,
        engineDefaults: env.engineDefaults,
        pin: { current: pinPepper, all: [pinPepper] },
        maxAttachmentBytes: env.maxAttachmentBytes,
        inviteCpfHashKey,
        certificateAi: {
          registry: certificateAi,
          healthCipher: HealthDataCipher.fromHex(env.certificateDataKeyHex),
        },
        superAdmin: {
          db: database.db,
          appPool: database.pool,
          clock,
          logger,
          recognition: new PgRecognitionStatsReader(arpPool),
          arpOps: new PgArpOpsReader(arpPool),
          queues,
          probes: { engineUrl: env.engine?.url ?? null, collectorUrl: env.collectorApiUrl },
          masterKeyHex: env.masterKeyHex,
          inviteCpfHashKey,
          version: API_VERSION,
          startedAt: clock.now(),
        },
      },
    },
    close: async () => {
      await queues?.close();
      await arpPool.end();
      await database.close();
    },
  };
}
