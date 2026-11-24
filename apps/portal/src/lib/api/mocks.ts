/**
 * Mocks dos endpoints que ainda não existem no back, no mesmo formato do contrato.
 * Ligados por NEXT_PUBLIC_USE_MOCKS=true. Dados fictícios, copiados do design.
 */
import type { Establishment, Me, Overview } from './contracts';

export const useMocks = () => process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export const mockMe: Me = {
  id: 1, tenantId: 1, employeeId: null, name: 'Lúcia Martins', email: 'lucia@exemplo.test',
  role: 'rh', mfaEnabled: false, establishmentScope: null, authenticatedVia: 'cookie',
};

export const mockEstablishments: Establishment[] = [
  { id: 1, name: 'Fazenda Santa Helena', subtitle: 'CAEPF · Rio Verde/GO' },
  { id: 2, name: 'Usina Boa Vista', subtitle: 'CNPJ · Quirinópolis/GO' },
  { id: 3, name: 'Granja São José', subtitle: 'CNPJ · Chapecó/SC' },
];

export const mockOverview: Overview = {
  kpis: [
    { key: 'workedHours', label: 'Horas trabalhadas', value: '18.432', unit: 'h', delta: '3,1%', trend: 'up', tone: 'good', comparison: 'vs. 17.878 h em 1 a 21 de out.' },
    { key: 'overtimeHours', label: 'Horas extras', value: '1.126', unit: 'h', delta: '12,4%', trend: 'up', tone: 'warn', comparison: 'vs. 1.002 h no período anterior' },
    { key: 'absences', label: 'Faltas', value: '37', unit: 'dias', delta: '17,8%', trend: 'down', tone: 'good', comparison: 'vs. 45 no período anterior' },
    { key: 'pendingCertificates', label: 'Atestados pendentes', value: '9', unit: '', delta: '+3', trend: 'up', tone: 'warn', comparison: '4 há mais de 2 dias na fila' },
    { key: 'activeVacations', label: 'Férias em curso', value: '14', unit: 'pessoas', delta: '+2', trend: 'up', tone: 'neutral', comparison: 'de 412 colaboradores ativos' },
  ],
  alerts: [
    { id: 'a1', severity: 'alerta', title: 'Marcações ímpares em Colheita', text: '6 colaboradores sem saída registrada ontem. Revise antes do fechamento de 30/11.', cta: 'Revisar marcações', target: 'apuracao' },
    { id: 'a2', severity: 'alerta', title: 'Interjornada menor que 11 h', text: '3 ocorrências em Manutenção nesta semana.', cta: 'Ver ocorrências', target: 'apuracao' },
    { id: 'a3', severity: 'sinal', title: 'Jornada de 42 h a partir de 16/12', text: '18 escalas ficam acima do novo limite semanal. Ajuste antes da vigência.', cta: 'Revisar escalas', target: 'escalas' },
    { id: 'a4', severity: 'sinal', title: 'Lote offline sincronizado', text: 'O coletor do Talhão 7 enviou 214 marcações de 19 e 20/11. Os dias foram recalculados.', cta: 'Ver apuração', target: 'apuracao' },
  ],
};
