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

export interface PortalDeps {
  db: Database;
  clock: Clock;
  access: PortalAccess;
  /** Batidas do arp, só leitura. */
  arp: ArpPunchReader;
  /** Arquivos de atestado. */
  storage: FileStorage;
  /** Engine facial; null = cadastro facial indisponível (503). */
  engine: FacialEngineClient | null;
  /** `current` gera hash novo; `all` confere (rotação do pepper). */
  pin: { current: PinPepper; all: readonly PinPepper[] };
  /** Tamanho máximo do arquivo de atestado. */
  maxAttachmentBytes: number;
  /** Análise de atestado (G6): provedores de IA (mock sem configuração) e cifra do dado de saúde (null = sem chave). */
  certificateAi: { registry: CertificateAiRegistry; healthCipher: HealthDataCipher | null };
}
