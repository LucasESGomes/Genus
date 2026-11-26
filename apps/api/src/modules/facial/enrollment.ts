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
import { AttemptLimiter } from '../../http/attempt-limiter';
import { tenantOf } from '../../http/access';
import { deviceEvents } from '../../db/schema';
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

export const identityBody = enrollmentFields.pick({ cpf: true, pin: true });
export const identityResponse = z.object({ data: z.object({ firstName: z.string(), alreadyEnrolled: z.boolean() }) });

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

/**
 * Quem está cadastrando: a sessão de rh/admin no totem antigo (`/facial/*`) ou o aparelho
 * identificado por `X-Device-Key` (`/totem/facial/*`). O serviço só precisa disto.
 */
export interface EnrollmentActor {
  tenantId: number;
  /** Usuário do painel; null quando quem opera é o aparelho. */
  userId: number | null;
  deviceId: number | null;
  /** Estabelecimentos permitidos; null = a conta inteira. */
  establishmentScope: number[] | null;
}

export const actorFromContext = (ctx: RequestContext): EnrollmentActor => ({
  tenantId: tenantOf(ctx),
  userId: ctx.userId,
  deviceId: null,
  establishmentScope: ctx.establishmentScope,
});

export interface FacialEnrollmentDeps {
  db: Database;
  clock: Clock;
  engine: FacialEngineClient | null;
  pin: { current: PinPepper; all: readonly PinPepper[] };
}

const limitKey = (actor: EnrollmentActor, ip: string) => `${actor.tenantId}:${ip}`;

const invalidCredentials = () => new HttpError(401, 'CPF_OU_PIN_INVALIDO', 'CPF ou PIN inválido');

export class FacialEnrollmentService {
  readonly limiter: AttemptLimiter;

  constructor(private readonly d: FacialEnrollmentDeps) {
    this.limiter = new AttemptLimiter(d.clock);
  }

  /** CPF do colaborador ativo, na conta e no escopo de quem cadastra; senão null. */
  private async employeeByCpf(actor: EnrollmentActor, rawCpf: string) {
    const emp = await findEmployeeByCpf(this.d.db, actor.tenantId, normalizeCpf(rawCpf));
    if (!emp || emp.terminationDate !== null) return null;
    if (actor.establishmentScope !== null && !actor.establishmentScope.includes(emp.establishmentId)) return null;
    return emp;
  }

  /** Confere CPF + PIN com o mesmo limite de tentativas do cadastro. */
  private async verifyCredentials(actor: EnrollmentActor, ip: string, cpf: string, pin: string) {
    const key = limitKey(actor, ip);
    this.limiter.assertAllowed(key);
    // conta antes de conferir: pedidos em paralelo não furam o limite; o acerto zera
    this.limiter.fail(key);
    const emp = await this.employeeByCpf(actor, cpf);
    // CPF inexistente, desligado ou fora do escopo e PIN errado dão a mesma resposta
    const ok = emp ? await verifyPin(pin, emp.pinHash, this.d.pin.all).catch(() => false) : false;
    if (!emp || !ok) throw invalidCredentials();
    this.limiter.reset(key);
    return emp;
  }

  /** Conferência antes das fotos: não grava consentimento nem nada. */
  async identifyAs(actor: EnrollmentActor, ip: string, cpf: string, pin: string) {
    const emp = await this.verifyCredentials(actor, ip, cpf, pin);
    const { enrolled } = await this.enrollmentOf(emp);
    return { firstName: emp.name.trim().split(/\s+/)[0] ?? '', alreadyEnrolled: enrolled };
  }

  status(ctx: RequestContext, cpf: string) {
    return this.statusAs(actorFromContext(ctx), cpf);
  }

  async statusAs(actor: EnrollmentActor, cpf: string) {
    const emp = await this.employeeByCpf(actor, cpf);
    if (!emp) return { enrolled: false, enrolledAt: null };
    return this.enrollmentOf(emp);
  }

  private async enrollmentOf(emp: { tenantId: number; id: number }) {
    const [row] = await this.d.db
      .select({ createdAt: facialEmbeddings.createdAt })
      .from(facialEmbeddings)
      .where(and(eq(facialEmbeddings.tenantId, emp.tenantId), eq(facialEmbeddings.employeeId, emp.id)));
    return { enrolled: Boolean(row), enrolledAt: row?.createdAt.toISOString() ?? null };
  }

  enroll(ctx: RequestContext, req: FastifyRequest) {
    return this.enrollAs(actorFromContext(ctx), req);
  }

  async enrollAs(actor: EnrollmentActor, req: FastifyRequest) {
    this.limiter.assertAllowed(limitKey(actor, req.ip));
    const { fields, images } = await parseEnrollment(req);
    const emp = await this.verifyCredentials(actor, req.ip, fields.cpf, fields.pin);

    if (!this.d.engine) throw new HttpError(503, 'MOTOR_FACIAL_INDISPONIVEL', 'O reconhecimento facial está indisponível. Tente mais tarde');
    const consentId = await this.ensureConsent(actor, emp, fields, req.ip);
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
        userId: actor.userId,
        entity: 'embeddings_faciais',
        entityId: row!.id,
        action: existing ? 'alteracao' : 'criacao',
        after: { event: 'facial.enrolled', employeeId: emp.id, origin: 'quiosque', images: values.imageCount, ...(actor.deviceId !== null ? { deviceId: actor.deviceId } : {}) },
      });
      // sem dado pessoal na descrição (o colaborador não é citado)
      if (actor.deviceId !== null) {
        await tx.insert(deviceEvents).values({ tenantId: emp.tenantId, deviceId: actor.deviceId, type: 'cadastro_facial', description: 'Cadastro facial concluído no totem', createdAt: now });
      }
    });
    return { employeeId: emp.id, enrolledAt: now.toISOString(), imagesProcessed: reply.images_processed, modelVersion: reply.model_version };
  }

  /** Consentimento ativo; sem ele, exige o aceite e grava (versão do texto, IP, quem coletou). */
  private async ensureConsent(actor: EnrollmentActor, emp: EmployeeRecord, fields: z.infer<typeof enrollmentFields>, ip: string): Promise<number> {
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
          deviceId: actor.deviceId,
          collectedById: actor.userId,
        })
        .returning({ id: biometricConsents.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: actor.userId,
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
