/**
 * Cadastro facial no totem (RF04, LGPD art. 11). Fluxo:
 *   1. o totem tem uma sessão de rh/admin (login feito uma vez no aparelho);
 *   2. o colaborador digita CPF e PIN e aceita o termo de consentimento;
 *   3. a api confere CPF + PIN (mesma resposta para qualquer erro, com limite de
 *      tentativas), registra o consentimento, lê a DEK CIFRADA da empresa e chama
 *      `POST /embeddings/register` da engine (que já existe; não é alterada);
 *   4. o embedding cifrado volta e é gravado como veio em `embeddings_faciais`.
 *
 * A api não cifra nem decifra nada: a criptografia dupla é a que já existe
 * (stored-crypto.ts + engine). Nunca loga CPF, PIN, foto, DEK nem embedding.
 */
import type { Clock } from '@genus/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { biometricConsents, companyKeys, facialEmbeddings } from '../../db/schema';
import { establishmentInScope, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeByCpf, type EmployeeRecord } from '../employees/lookup';
import { verifyPin, type PinPepper } from '../employees/pin';
import { normalizeCpf } from '../employees/rules/cpf';
import { EngineRejectedError, EngineUnavailableError, type EnrollImage, type FacialEngineClient } from './engine-client';
import { engineTenantId, fromStoredCompanyKey, toStoredEmbedding } from './stored-crypto';

export const enrollmentFields = z.object({
  cpf: z.string().trim().min(11).max(14),
  pin: z.string().regex(/^[0-9]{4,6}$/, 'PIN de 4 a 6 dígitos'),
  consentAccepted: z.enum(['true', 'false']).transform((v) => v === 'true'),
  consentTextVersion: z.string().trim().min(1).max(40),
});

export const enrollmentResponse = z.object({
  data: z.object({ employeeId: z.number(), enrolledAt: z.string(), imagesProcessed: z.number(), modelVersion: z.string() }),
});
export const facialStatusBody = z.object({ cpf: z.string().trim().min(11).max(14) });
export const facialStatusResponse = z.object({ data: z.object({ enrolled: z.boolean(), enrolledAt: z.string().nullable() }) });

const IMAGE_TYPES = [
  { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
] as const;
const MAX_IMAGES = 5;

/** Limite simples de tentativas erradas de CPF/PIN por IP e conta (memória do processo). */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string): number[] {
    const now = this.clock.now().getTime();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  assertAllowed(key: string): void {
    if (this.recent(key).length >= this.max) throw new HttpError(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde alguns minutos');
  }

  fail(key: string): void {
    this.recent(key).push(this.clock.now().getTime());
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export interface FacialEnrollmentDeps {
  db: Database;
  clock: Clock;
  engine: FacialEngineClient | null;
  pin: { current: PinPepper; all: readonly PinPepper[] };
}

const invalidCredentials = () => new HttpError(401, 'CPF_OU_PIN_INVALIDO', 'CPF ou PIN inválido');

export class FacialEnrollmentService {
  readonly limiter: AttemptLimiter;

  constructor(private readonly d: FacialEnrollmentDeps) {
    this.limiter = new AttemptLimiter(d.clock);
  }

  /** CPF do colaborador ativo, na conta e no escopo da sessão do totem; senão null. */
  private async employeeByCpf(ctx: RequestContext, rawCpf: string) {
    const emp = await findEmployeeByCpf(this.d.db, tenantOf(ctx), normalizeCpf(rawCpf));
    if (!emp || emp.terminationDate !== null || !establishmentInScope(ctx, emp.establishmentId)) return null;
    return emp;
  }

  async status(ctx: RequestContext, cpf: string) {
    const emp = await this.employeeByCpf(ctx, cpf);
    if (!emp) return { enrolled: false, enrolledAt: null };
    const [row] = await this.d.db
      .select({ createdAt: facialEmbeddings.createdAt })
      .from(facialEmbeddings)
      .where(and(eq(facialEmbeddings.tenantId, emp.tenantId), eq(facialEmbeddings.employeeId, emp.id)));
    return { enrolled: Boolean(row), enrolledAt: row?.createdAt.toISOString() ?? null };
  }

  async enroll(ctx: RequestContext, req: FastifyRequest) {
    const tenantId = tenantOf(ctx);
    const limitKey = `${tenantId}:${req.ip}`;
    this.limiter.assertAllowed(limitKey);
    const { fields, images } = await parseEnrollment(req);

    const emp = await this.employeeByCpf(ctx, fields.cpf);
    // CPF inexistente, desligado ou fora do escopo e PIN errado dão a mesma resposta
    const ok = emp ? await verifyPin(fields.pin, emp.pinHash, this.d.pin.all).catch(() => false) : false;
    if (!emp || !ok) {
      this.limiter.fail(limitKey);
      throw invalidCredentials();
    }
    this.limiter.reset(limitKey);

    if (!this.d.engine) throw new HttpError(503, 'MOTOR_FACIAL_INDISPONIVEL', 'O reconhecimento facial está indisponível. Tente mais tarde');
    const consentId = await this.ensureConsent(ctx, emp, fields, req.ip);
    const [key] = await this.d.db
      .select()
      .from(companyKeys)
      .where(and(eq(companyKeys.tenantId, emp.tenantId), eq(companyKeys.companyId, emp.companyId), eq(companyKeys.isActive, true)));
    if (!key) throw new HttpError(409, 'CHAVE_EMPRESA_AUSENTE', 'A empresa ainda não tem chave de biometria configurada');

    let reply;
    try {
      reply = await this.d.engine.registerEmbedding({
        engineTenantId: engineTenantId(emp.companyId),
        personId: emp.id,
        images,
        dek: fromStoredCompanyKey(key),
      });
    } catch (err) {
      // o texto da engine nunca é repassado
      if (err instanceof EngineRejectedError) throw new HttpError(422, 'ROSTO_NAO_PROCESSADO', 'Não foi possível reconhecer um rosto nas fotos. Tente de novo');
      if (err instanceof EngineUnavailableError) throw new HttpError(503, 'MOTOR_FACIAL_INDISPONIVEL', 'O reconhecimento facial está indisponível. Tente mais tarde');
      throw err;
    }
    const stored = toStoredEmbedding({ ivHex: reply.embedding_iv, tagHex: reply.embedding_tag, ciphertextHex: reply.embedding_ct, keyVersion: key.keyVersion });
    const now = this.d.clock.now();
    const values = {
      tenantId: emp.tenantId,
      employeeId: emp.id,
      companyId: emp.companyId,
      consentId,
      ...stored,
      modelVersion: reply.model_version,
      imageCount: Math.min(Math.max(reply.images_processed, 1), MAX_IMAGES),
      origin: 'quiosque',
      createdAt: now,
    };
    await this.d.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: facialEmbeddings.id })
        .from(facialEmbeddings)
        .where(and(eq(facialEmbeddings.tenantId, emp.tenantId), eq(facialEmbeddings.employeeId, emp.id)))
        .for('update');
      const [row] = await tx
        .insert(facialEmbeddings)
        .values(values)
        .onConflictDoUpdate({
          target: [facialEmbeddings.tenantId, facialEmbeddings.employeeId],
          set: { ...stored, companyId: values.companyId, consentId, modelVersion: values.modelVersion, imageCount: values.imageCount, origin: values.origin, createdAt: now },
        })
        .returning({ id: facialEmbeddings.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'embeddings_faciais',
        entityId: row!.id,
        action: existing ? 'alteracao' : 'criacao',
        after: { event: 'facial.enrolled', employeeId: emp.id, origin: 'quiosque', images: values.imageCount },
      });
    });
    return { employeeId: emp.id, enrolledAt: now.toISOString(), imagesProcessed: reply.images_processed, modelVersion: reply.model_version };
  }

  /** Consentimento ativo; sem ele, exige o aceite e grava (versão do texto, IP, quem coletou). */
  private async ensureConsent(ctx: RequestContext, emp: EmployeeRecord, fields: z.infer<typeof enrollmentFields>, ip: string): Promise<number> {
    const [active] = await this.d.db
      .select({ id: biometricConsents.id })
      .from(biometricConsents)
      .where(and(eq(biometricConsents.tenantId, emp.tenantId), eq(biometricConsents.employeeId, emp.id), isNull(biometricConsents.revokedAt)));
    if (active) return active.id;
    if (!fields.consentAccepted) throw new HttpError(409, 'CONSENTIMENTO_AUSENTE', 'É preciso aceitar o termo de uso da biometria');
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(biometricConsents)
        .values({
          tenantId: emp.tenantId,
          employeeId: emp.id,
          textVersion: fields.consentTextVersion,
          consentedAt: this.d.clock.now(),
          ipAddress: ip,
          collectedById: ctx.userId,
        })
        .returning({ id: biometricConsents.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'consentimentos_biometricos',
        entityId: row!.id,
        action: 'criacao',
        after: { textVersion: fields.consentTextVersion, ip },
      });
      return row!.id;
    });
  }
}

async function parseEnrollment(req: FastifyRequest): Promise<{ fields: z.infer<typeof enrollmentFields>; images: EnrollImage[] }> {
  if (!req.isMultipart()) throw new HttpError(400, 'VALIDATION_ERROR', 'A requisição deve ser multipart/form-data');
  const raw: Record<string, string> = {};
  const images: EnrollImage[] = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      if (part.fieldname !== 'photos') throw new HttpError(400, 'VALIDATION_ERROR', 'Envie as fotos no campo photos');
      const type = IMAGE_TYPES.find((t) => data.subarray(0, t.magic.length).equals(t.magic));
      if (!type) throw new HttpError(400, 'ARQUIVO_INVALIDO', 'As fotos devem ser JPEG ou PNG');
      images.push({ data, mime: type.mime });
    } else if (['cpf', 'pin', 'consentAccepted', 'consentTextVersion'].includes(part.fieldname)) {
      raw[part.fieldname] = String(part.value);
    }
  }
  const parsed = enrollmentFields.safeParse(raw);
  if (!parsed.success) {
    // só o caminho do campo: o valor (CPF, PIN) nunca volta na resposta
    throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: 'campo inválido' })));
  }
  if (images.length < 1 || images.length > MAX_IMAGES) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Envie de 1 a 5 fotos', [{ path: 'photos', message: 'de 1 a 5 fotos' }]);
  }
  return { fields: parsed.data, images };
}
