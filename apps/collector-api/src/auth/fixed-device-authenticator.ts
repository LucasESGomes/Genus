import type { DeviceAuthenticator, DeviceContext } from '@genus/shared';

/**
 * PROVISÓRIO: devolve sempre o mesmo contexto, vindo da configuração de dev
 * (DEV_TENANT_ID, DEV_ESTABLISHMENT_ID, DEV_DEVICE_ID). Será trocado por
 * certificado mTLS / token do aparelho, validado contra o banco `app`.
 * O contexto NUNCA vem do corpo da requisição.
 */
export class FixedDeviceAuthenticator implements DeviceAuthenticator {
  constructor(private readonly context: DeviceContext) {}

  async resolve(): Promise<DeviceContext> {
    return { ...this.context };
  }
}
