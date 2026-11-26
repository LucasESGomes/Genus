/**
 * Harness dos testes do portal de RH: Postgres real do RH (e do arp, quando o
 * teste lê batidas), app com login de verdade (Better Auth) e os módulos do
 * portal. Pessoas, CPFs e senhas são fictícios.
 */
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createLogger, FixedClock, SystemClock, type Clock } from '@genus/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { expect } from 'vitest';
import { TimeBankPoster } from '../../src/modules/time-bank/poster';
import { PgArpPunchReader, type ArpPunchReader } from '../../src/arp/punch-reader';
import { buildApp } from '../../src/app';
import { createDatabase, type DatabaseHandle } from '../../src/db/client';
import { PortalAccess } from '../../src/http/access';
import { createAuth } from '../../src/modules/auth/auth';
import { UserService } from '../../src/modules/auth/user-service';
import type { FacialEngineClient } from '../../src/modules/facial/engine-client';
import type { PinPepper } from '../../src/modules/employees/pin';
import { deriveInviteCpfKey } from '../../src/modules/invites/crypto';
import { MemoryStorage } from '../../src/storage/file-storage';
import { CertificateAiRegistry, MOCK_ONLY_CONFIG } from '../../src/modules/certificate-analysis/ai/registry';
import { HealthDataCipher } from '../../src/modules/certificate-analysis/health-crypto';
import type { Role } from '../../src/plugins/request-context';
import type { ArpOpsReader, RecognitionStatsReader, SuperAdminDeps } from '../../src/modules/super-admin/deps';
import { FAKE_PIN_HASH, FAKE_PIN_SET_AT } from './fake-pin';
import { startRhTestDatabase, type RhTestDatabase } from './rh-database';
import { timesheetParams, vacationParams, workweekParams } from './rh-legal-fixtures';

export const BASE_URL = 'http://localhost:3002';
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
export const PASSWORD = 'senha-ficticia-forte-123';
export const TEST_PEPPER: PinPepper = { version: 1, key: Buffer.alloc(32, 7) };
/** Chave fictícia do dado de saúde (64 hex), só para teste. */
export const TEST_HEALTH_KEY = '11'.repeat(32);

export interface Org {
  tenantId: number;
  companyId: number;
  establishmentId: number;
  otherEstablishmentId: number;
  departmentId: number;
  jobTitleId: number;
  costCenterId: number;
}

export interface HarnessOptions {
  /** Sobe também o banco arp (para a apuração). */
  arp?: boolean;
  gestorEnabled?: boolean;
  clock?: Clock;
  engine?: FacialEngineClient | null;
  /** Provedores de IA da análise de atestado (padrão: só a mock). */
  certificateAi?: CertificateAiRegistry;
  /** Cifra do dado de saúde; null = sem chave. Padrão: chave fictícia de teste. */
  healthCipher?: HealthDataCipher | null;
  /** Troca dependências do painel do super_admin (padrão: stubs vazios, sem Valkey, sem probes, com MASTER_KEY de teste). */
  superAdmin?: Partial<SuperAdminDeps>;
  /**
   * Mantém os feriados nacionais da migration 0021. Padrão: apaga, para os testes de apuração não
   * dependerem do calendário (cada teste que precisa de feriado o cadastra).
   */
  keepNationalHolidays?: boolean;
}

/** KEK fictícia (64 hex), só para teste. */
export const TEST_MASTER_KEY = '22'.repeat(32);

const emptyRecognition: RecognitionStatsReader = {
  summary: async () => ({
    punches: 0, pendente: 0, processado: 0, falhou: 0, divergentClock: 0,
    recognitionAvg: null, recognitionP50: null, recognitionP05: null,
    livenessAvg: null, livenessP50: null, livenessP05: null, livenessHistogram: Array<number>(10).fill(0),
  }),
  series: async () => [],
  devices: async () => [],
};
const emptyArpOps: ArpOpsReader = {
  ping: async () => undefined,
  punchesPerDay: async () => [],
  pendingEntries: async () => ({ count: 0, oldestAgeSeconds: null }),
  pendingOutbox: async () => ({ count: 0, oldestAgeSeconds: null }),
};

let seq = 0;
const next = () => (seq += 1);

/** CPF fictício com dígitos verificadores válidos. */
export function fakeCpf(n = next()): string {
  const base = String(100_000_000 + n).slice(-9);
  const d = base.split('').map(Number);
  const dv = (digits: number[]) => {
    const len = digits.length;
    const sum = digits.reduce((s, x, i) => s + x * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  return `${base}${d1}${d2}`;
}

export class PortalHarness {
  rh!: RhTestDatabase;
  arpDb: ArpTestDatabase | null = null;
  client!: pg.Client;
  handle!: DatabaseHandle;
  app!: FastifyInstance;
  users!: UserService;
  storage = new MemoryStorage();
  readonly logLines: string[] = [];
  private arpPool: pg.Pool | null = null;

  constructor(private readonly o: HarnessOptions = {}) {}

  async start(): Promise<void> {
    const [rh, arpDb] = await Promise.all([startRhTestDatabase(), this.o.arp ? startArpTestDatabase() : Promise.resolve(null)]);
    this.rh = rh;
    this.arpDb = arpDb;
    this.client = new pg.Client({ connectionString: rh.url });
    await this.client.connect();
    if (!this.o.keepNationalHolidays) await this.client.query('DELETE FROM rh.feriados WHERE conta_id IS NULL');
    this.handle = createDatabase(rh.url, createLogger({ level: 'silent', service: 'test' }), 6);
    this.users = new UserService({ db: this.handle.db });
    this.app = await this.newApp();
  }

  async newApp(over: Partial<HarnessOptions> = {}): Promise<FastifyInstance> {
    const o = { ...this.o, ...over };
    const logger = createLogger({
      level: 'debug',
      service: 'test',
      destination: new Writable({
        write: (chunk: Buffer, _enc, cb) => {
          this.logLines.push(chunk.toString());
          cb();
        },
      }),
    });
    const clock = o.clock ?? new SystemClock();
    const auth = createAuth(this.handle.db, { secret: SECRET, baseURL: BASE_URL, trustedOrigins: [], secureCookies: false, rateLimit: false }, logger);
    let arp: ArpPunchReader = { listPunches: async () => [], devicesWithPunches: async () => new Set<number>() };
    if (this.arpDb) {
      this.arpPool ??= new pg.Pool({ connectionString: this.arpDb.readerUrl, max: 4 });
      arp = new PgArpPunchReader(this.arpPool);
    }
    return buildApp({
      logger,
      pool: this.handle.pool,
      db: this.handle.db,
      corsOrigins: [],
      auth: { auth, baseURL: BASE_URL, clock: new SystemClock() },
      portal: {
        db: this.handle.db,
        clock,
        access: new PortalAccess(o.gestorEnabled ?? false),
        arp,
        posting: new TimeBankPoster({ clock }),
        storage: this.storage,
        engine: o.engine ?? null,
        engineDefaults: { recognitionThreshold: 1.1, livenessThreshold: 0.85 },
        pin: { current: TEST_PEPPER, all: [TEST_PEPPER] },
        maxAttachmentBytes: 1024 * 1024,
        inviteCpfHashKey: deriveInviteCpfKey(SECRET),
        certificateAi: {
          registry: o.certificateAi ?? new CertificateAiRegistry(MOCK_ONLY_CONFIG),
          healthCipher: o.healthCipher === undefined ? HealthDataCipher.fromHex(TEST_HEALTH_KEY) : o.healthCipher,
        },
        superAdmin: {
          db: this.handle.db,
          appPool: this.handle.pool,
          clock,
          logger,
          recognition: emptyRecognition,
          arpOps: emptyArpOps,
          queues: null,
          probes: { engineUrl: null, collectorUrl: null },
          masterKeyHex: TEST_MASTER_KEY,
          inviteCpfHashKey: deriveInviteCpfKey(SECRET),
          version: '0.0.0-test',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          healthTimeoutMs: 500,
          ...o.superAdmin,
        },
      },
    });
  }

  /** Pool do papel arp_reader (harness com `arp: true`), para os readers reais do painel do super_admin. */
  arpReaderPool(): pg.Pool {
    if (!this.arpDb) throw new Error('harness sem arp');
    this.arpPool ??= new pg.Pool({ connectionString: this.arpDb.readerUrl, max: 4 });
    return this.arpPool;
  }

  /**
   * super_admin logado e com 2FA ativo. Loga com a senha (mfa ainda desligado, então sem desafio TOTP)
   * e depois liga `mfa_ativo`: o request-context relê o usuário a cada requisição. `withMfa: false`
   * deixa o usuário sem 2FA (para o teste do 403).
   */
  async loginAsSuperAdmin(opts: { withMfa?: boolean; app?: FastifyInstance } = {}): Promise<{ userId: number; cookie: string }> {
    const s = await this.loginAs(null, 'super_admin', { app: opts.app });
    if (opts.withMfa ?? true) await this.client.query('UPDATE rh.usuarios SET mfa_ativo = true WHERE id = $1', [s.userId]);
    return s;
  }

  async stop(): Promise<void> {
    await this.app?.close();
    await this.arpPool?.end();
    await this.handle?.close();
    await this.client?.end();
    await Promise.all([this.rh?.stop(), this.arpDb?.stop()]);
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    return (await this.client.query(sql, params)).rows[0] as T;
  }

  async id(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await this.one<{ id: string }>(sql, params)).id);
  }

  /** Conta com empresa, dois estabelecimentos, setor, cargo e centro de custo. */
  async createOrg(opts: { maxSimultaneousVacations?: number } = {}): Promise<Org> {
    const n = next();
    const tenantId = await this.id("INSERT INTO rh.contas (nome) VALUES ('Conta Teste') RETURNING id");
    const cnpj = String(11_000_000_000_000 + n * 100).padStart(14, '0');
    const companyId = await this.id("INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, 'Fazenda Fictícia Ltda', $2) RETURNING id", [tenantId, cnpj]);
    const est = (nome: string, insc: string) =>
      this.id(
        `INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
         VALUES ($1, $2, $3, 'CNPJ', $4, 'SP', '3550308') RETURNING id`,
        [tenantId, companyId, nome, insc],
      );
    const establishmentId = await est('Matriz', cnpj);
    const otherEstablishmentId = await est('Filial', cnpj.slice(0, 12) + '99');
    const departmentId = await this.id(
      "INSERT INTO rh.setores (conta_id, estabelecimento_id, nome, limite_ferias_simultaneas) VALUES ($1, $2, 'Colheita', $3) RETURNING id",
      [tenantId, establishmentId, opts.maxSimultaneousVacations ?? 1],
    );
    const jobTitleId = await this.id("INSERT INTO rh.cargos (conta_id, empresa_id, nome) VALUES ($1, $2, 'Operador Rural') RETURNING id", [tenantId, companyId]);
    const costCenterId = await this.id("INSERT INTO rh.centros_custo (conta_id, empresa_id, codigo, nome) VALUES ($1, $2, 'CC1', 'Campo') RETURNING id", [
      tenantId,
      companyId,
    ]);
    return { tenantId, companyId, establishmentId, otherEstablishmentId, departmentId, jobTitleId, costCenterId };
  }

  async createEmployee(
    org: Org,
    opts: { establishmentId?: number; cpf?: string; managerId?: number | null; admissionDate?: string; pinHash?: string } = {},
  ): Promise<{ id: number; cpf: string }> {
    const cpf = opts.cpf ?? fakeCpf();
    const id = await this.id(
      `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, gestor_id, pin_hash, pin_definido_em)
       VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', $4, $5, $6, $7) RETURNING id`,
      [org.tenantId, opts.establishmentId ?? org.establishmentId, cpf, opts.admissionDate ?? '2024-01-01', opts.managerId ?? null, opts.pinHash ?? FAKE_PIN_HASH, FAKE_PIN_SET_AT],
    );
    return { id, cpf };
  }

  /** Vínculo vigente no setor da org (o setor é necessário para férias). */
  async createAssignment(org: Org, employeeId: number, validFrom = '2024-01-01'): Promise<number> {
    return this.id(
      `INSERT INTO rh.vinculos_colaborador (conta_id, colaborador_id, cargo_id, setor_id, tipo_contrato, salario_base, vigencia_inicio)
       VALUES ($1, $2, $3, $4, 'indeterminado', 2500.00, $5) RETURNING id`,
      [org.tenantId, employeeId, org.jobTitleId, org.departmentId, validFrom],
    );
  }

  /** Usuário com papel, escopo de estabelecimento opcional, já logado (cookie). */
  async loginAs(
    org: Org | null,
    role: Role,
    opts: { employeeId?: number | null; establishments?: number[]; app?: FastifyInstance } = {},
  ): Promise<{ userId: number; cookie: string }> {
    const n = next();
    const user = await this.users.createUser({
      tenantId: org?.tenantId ?? null,
      email: `${role}${n}@portal.teste.dev`,
      name: `Usuário ${role} ${n}`,
      role,
      employeeId: opts.employeeId ?? null,
      password: PASSWORD,
    });
    for (const est of opts.establishments ?? []) {
      await this.client.query('INSERT INTO rh.usuarios_estabelecimentos (conta_id, usuario_id, estabelecimento_id) VALUES ($1, $2, $3)', [
        org!.tenantId,
        user.id,
        est,
      ]);
    }
    const res = await (opts.app ?? this.app).inject({
      method: 'POST',
      url: '/auth/sign-in/email',
      headers: { origin: BASE_URL },
      payload: { email: user.email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    return { userId: Number(user.id), cookie: cookiesOf(res) };
  }

  /** Requisição autenticada no app do harness. */
  call(cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, app = this.app): Promise<LightMyRequestResponse> {
    return app.inject({ method, url, headers: { cookie, origin: BASE_URL }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  }

  /** Parâmetros legais padrão (conta NULL), a partir da fixture das regras. */
  async seedLegalParameters(): Promise<void> {
    const rows = [...timesheetParams(), ...vacationParams(), ...workweekParams()];
    // A migration 0019 já carrega o padrão global: o teste troca pela fixture.
    await this.client.query('DELETE FROM rh.parametros_legais WHERE conta_id IS NULL');
    for (const r of rows) {
      await this.client.query(
        'INSERT INTO rh.parametros_legais (chave, valor, base_legal, vigencia_inicio, vigencia_fim) VALUES ($1, $2::jsonb, $3, $4, $5)',
        [r.key, JSON.stringify(r.value), r.legalBasis, r.validFrom, r.validTo],
      );
    }
  }

  /** Batida fiscal no arp (como o rep-core grava: registro tipo 7 com NSR). Só fixture. */
  async insertArpPunch(p: { tenantId: number; establishmentId: number; nsr: number; cpf: string; at: string; offline?: boolean }): Promise<void> {
    if (!this.arpDb) throw new Error('harness sem arp');
    const c = new pg.Client({ connectionString: this.arpDb.coreUrl });
    await c.connect();
    try {
      const hash = createHash('sha256').update(`${p.establishmentId}:${p.nsr}`).digest();
      await c.query(
        `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em, tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
         VALUES ($1, $2, $3, '7', $4, $5, $5, '01', $6, $7, $8, 1)`,
        [p.establishmentId, p.nsr, p.tenantId, p.cpf, p.at, p.offline ?? false, hash, Buffer.alloc(32)],
      );
    } finally {
      await c.end();
    }
  }

  /** Nenhuma linha de log tem os valores sensíveis dados. */
  expectLogsWithout(...values: string[]): void {
    const all = this.logLines.join('\n');
    for (const v of values) expect(all.includes(v), `log contém valor sensível`).toBe(false);
  }
}

export function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ');
}

export { FixedClock };
