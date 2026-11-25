/**
 * Atestados e análise (certificates, certificate-analysis). Dado de saúde: o texto colado para análise
 * e o arquivo nunca vão para storage, URL, log ou cache persistente. A análise só SUGERE.
 */
import { qs, type ApiClient } from '../client';
import type {
  AnalyzeCertificateBody, AnalyzeCertificateResult, Certificate, CertificateAnalysis, CertificateListQuery, CertificateRh, EntityId, Envelope, Paged,
  RejectCertificateBody,
} from '../contracts';
import { apiPath } from '../ids';

export const certificatesApi = (c: ApiClient) => ({
  /** RH recebe CertificateRh (médico, arquivo); admin/gestor recebem Certificate. */
  list: (q: CertificateListQuery, signal?: AbortSignal) =>
    c.get<Paged<Certificate | CertificateRh>>(
      `/portal/certificates${qs({ status: q.status, employeeId: q.employeeId, q: q.q, page: q.page, pageSize: q.pageSize })}`,
      signal,
    ),
  /** Download auditado (só rh). Abrir com createObjectURL e REVOGAR ao fechar; nunca guardar. */
  file: (id: EntityId, signal?: AbortSignal) => c.blob(apiPath`/portal/certificates/${id}/file`, signal),
  approve: async (id: EntityId) => (await c.post<Envelope<Certificate | CertificateRh>>(apiPath`/portal/certificates/${id}/approve`)).data,
  reject: async (id: EntityId, body: RejectCertificateBody) =>
    (await c.post<Envelope<Certificate | CertificateRh>>(apiPath`/portal/certificates/${id}/reject`, body)).data,
  analyze: async (id: EntityId, body: AnalyzeCertificateBody) =>
    (await c.post<Envelope<AnalyzeCertificateResult>>(apiPath`/portal/certificates/${id}/analyze`, body)).data,
  analyses: async (id: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<CertificateAnalysis[]>>(apiPath`/portal/certificates/${id}/analyses`, signal)).data,
});
export type CertificatesApi = ReturnType<typeof certificatesApi>;
