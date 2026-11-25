/**
 * Colaboradores fictícios compartilhados por todos os mocks (dono: orquestrador). Nomes, matrículas,
 * setores e cargos do design (APUR, AT, SETORES_FER). IDs fixos para os módulos se referirem uns aos outros:
 * '101' é o colaborador da sessão de mock (João Pereira). CPFs são fictícios e inválidos de propósito.
 */
import { DEPARTMENTS, JOB_TITLES } from './index';

export interface SeedEmployee {
  id: string;
  establishmentId: string;
  name: string;
  registrationNumber: string;
  /** Fictício (prefixo 000): nunca um CPF real. */
  cpf: string;
  departmentName: string;
  jobTitleName: string;
  admissionDate: string;
  birthDate: string;
  status: 'ativo' | 'desligado';
}

const row = (id: number, name: string, mat: string, dept: string, job: string, admission = '2021-03-01', establishmentId = '1'): SeedEmployee => ({
  id: String(id), establishmentId, name, registrationNumber: mat, cpf: `000${String(id).padStart(8, '0')}`,
  departmentName: dept, jobTitleName: job, admissionDate: admission, birthDate: '1988-06-15', status: 'ativo',
});

export const SEED_EMPLOYEES: SeedEmployee[] = [
  row(101, 'João Pereira', '00401', 'Colheita', 'Trabalhador rural', '2023-02-01'),
  row(102, 'Antônio Carlos Ferreira', '00412', 'Colheita', 'Operador de colhedora', '2019-08-12'),
  row(103, 'Maria Aparecida Souza', '00418', 'Ordenha', 'Ordenhadora', '2020-01-06'),
  row(104, 'José Roberto Lima', '00433', 'Colheita', 'Trabalhador rural', '2022-05-02'),
  row(105, 'Luciana Pereira Alves', '00451', 'Agroindústria', 'Auxiliar de produção', '2021-10-18'),
  row(106, 'Francisco das Chagas Silva', '00467', 'Manutenção', 'Mecânico', '2018-04-09'),
  row(107, 'Rita de Cássia Moura', '00472', 'Ordenha', 'Ordenhadora', '2020-07-20'),
  row(108, 'Edson Barbosa Nunes', '00488', 'Colheita', 'Tratorista', '2017-11-13'),
  row(109, 'Cláudia Regina Teixeira', '00490', 'Administrativo', 'Assistente administrativa', '2016-02-15'),
  row(110, 'Valdir Antunes Rocha', '00502', 'Manutenção', 'Eletricista', '2019-03-25'),
  row(111, 'Paulo Henrique Dias', '00515', 'Colheita', 'Trabalhador rural', '2023-09-04'),
  row(112, 'Joaquim Mendes', '00436', 'Ordenha', 'Ordenhadora', '2015-06-01'),
  row(113, 'Sebastião Prado', '00441', 'Colheita', 'Trabalhador rural', '2014-10-10'),
  row(114, 'Joana Ribeiro', '00520', 'Ordenha', 'Ordenhadora', '2024-01-15'),
  row(115, 'Daniela Costa', '00524', 'Ordenha', 'Ordenhadora', '2024-03-04'),
  row(116, 'Marcos Vinícius Rocha', '00531', 'Agroindústria', 'Auxiliar de produção', '2022-08-01'),
  row(117, 'Tereza Gomes', '00536', 'Agroindústria', 'Auxiliar de produção', '2021-05-17'),
  row(201, 'Ana Lúcia Freitas', '10010', 'Agroindústria', 'Conferente', '2020-02-03', '2'),
  row(202, 'Roberto Nogueira', '10014', 'Manutenção', 'Mecânico', '2019-09-09', '2'),
  row(301, 'Helena Batista', '20005', 'Armazém', 'Conferente', '2022-11-21', '3'),
];

/** ID do setor/cargo no mock (mesmos de mockDepartments/mockJobTitles em mocks/index.ts). */
export const departmentIdOf = (name: string) => String(10 + DEPARTMENTS.indexOf(name));
export const jobTitleIdOf = (name: string) => String(30 + JOB_TITLES.indexOf(name));

export const seedEmployee = (id: string) => SEED_EMPLOYEES.find((e) => e.id === id);

/** CPF como a api devolve: completo para rh/admin, mascarado para os demais (FULL_CPF_ROLES). */
export const cpfFor = (cpf: string, role: string) => (role === 'rh' || role === 'admin' ? cpf : `***.***.***-${cpf.slice(-2)}`);
