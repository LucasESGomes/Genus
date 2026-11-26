/** Dependências dos módulos do portal (montadas no container; trocadas nos testes). */
import type { Clock } from '@genus/shared';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import type { PortalAccess } from '../../http/access';
import type { FileStorage } from '../../storage/file-storage';
import type { PinPepper } from '../employees/pin';
import type { CertificateAiRegistry } from '../certificate-analysis/ai/registry';
import type { HealthDataCipher } from '../certificate-analysis/health-crypto';
import type { FacialEngineClient } from '../facial/engine-client';
import type { SuperAdminDeps } from '../super-admin/deps';
import type { DayPostingHook } from '../time-bank/posting-hook';

export interface PortalDeps {
  db: Database;
  clock: Clock;
  access: PortalAccess;
  /** Batidas do arp, só leitura. */
  arp: ArpPunchReader;
  /** Lançamento no banco de horas, chamado pela apuração. Ausente = nada é lançado. */
  posting?: DayPostingHook;
  /** Arquivos de atestado. */
  storage: FileStorage;
  /** Engine facial; null = cadastro facial indisponível (503). */
  engine: FacialEngineClient | null;
  /** Limiares padrão da engine, para o valor efetivo de um totem não calibrado (docs/totem-contrato.md §3.1). */
  engineDefaults: { recognitionThreshold: number; livenessThreshold: number };
  /** `current` gera hash novo; `all` confere (rotação do pepper). */
  pin: { current: PinPepper; all: readonly PinPepper[] };
  /** Tamanho máximo do arquivo de atestado. */
  maxAttachmentBytes: number;
  /** Chave do HMAC do CPF dos convites (`deriveInviteCpfKey`, derivada do BETTER_AUTH_SECRET). */
  inviteCpfHashKey: Buffer;
  /** Análise de atestado (G6): provedores de IA (mock sem configuração) e cifra do dado de saúde (null = sem chave). */
  certificateAi: { registry: CertificateAiRegistry; healthCipher: HealthDataCipher | null };
  /** Painel do super_admin (/portal/super-admin). Ausente = rotas não registradas. */
  superAdmin?: SuperAdminDeps;
}
