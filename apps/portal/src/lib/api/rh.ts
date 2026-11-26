/**
 * Ponto único de acesso à api do portal. Uma propriedade por módulo do back.
 * NEXT_PUBLIC_USE_MOCKS=true: TODOS os módulos respondem com mock (o portal roda sem back).
 * false: módulos reais chamam a api; os que o back não tem respondem `unavailable` ("Em breve").
 */
import { createApiClient, type ApiClient } from './client';
import { absencesApi } from './endpoints/absences';
import { adjustmentsApi } from './endpoints/adjustments';
import { adminApi } from './endpoints/admin';
import { authApi } from './endpoints/auth';
import { certificatesApi } from './endpoints/certificates';
import { closingsApi } from './endpoints/closings';
import { devicesApi } from './endpoints/devices';
import { employeePortalApi } from './endpoints/employee-portal';
import { employeesApi } from './endpoints/employees';
import { invitesApi } from './endpoints/invites';
import { orgApi } from './endpoints/org';
import { organizationApi } from './endpoints/organization';
import { overviewApi } from './endpoints/overview';
import { schedulesApi } from './endpoints/schedules';
import { superAdminApi } from './endpoints/super-admin';
import { timeBankApi } from './endpoints/time-bank';
import { timesheetsApi } from './endpoints/timesheets';
import { vacationsApi } from './endpoints/vacations';
import { mockAbsencesApi } from './mocks/absences';
import { mockAdjustmentsApi } from './mocks/adjustments';
import { mockAdminApi } from './mocks/admin';
import { mockCertificatesApi } from './mocks/certificates';
import { mockClosingsApi } from './mocks/closings';
import { mockDevicesApi } from './mocks/devices';
import { mockEmployeePortalApi } from './mocks/employee-portal';
import { mockEmployeesApi } from './mocks/employees';
import { mockAuthApi, mockOrgApi, mockOverviewApi } from './mocks/index';
import { mockInvitesApi } from './mocks/invites';
import { mockOrganizationApi } from './mocks/organization';
import { useMocks } from './mocks/runtime';
import { mockSchedulesApi } from './mocks/schedules';
import { mockSuperAdminApi } from './mocks/super-admin';
import { mockTimeBankApi } from './mocks/time-bank';
import { mockTimesheetsApi } from './mocks/timesheets';
import { mockVacationsApi } from './mocks/vacations';

export function createRealApi(c: ApiClient = createApiClient()) {
  return {
    auth: authApi(c),
    org: orgApi(c),
    overview: overviewApi(c),
    employees: employeesApi(c),
    schedules: schedulesApi(c),
    timesheets: timesheetsApi(c),
    adjustments: adjustmentsApi(c),
    absences: absencesApi(c),
    certificates: certificatesApi(c),
    vacations: vacationsApi(c),
    closings: closingsApi(c),
    timeBank: timeBankApi(c),
    employeePortal: employeePortalApi(c),
    devices: devicesApi(c),
    admin: adminApi(c),
    superAdmin: superAdminApi(c),
    organization: organizationApi(c),
    invites: invitesApi(c),
  };
}

export type RhApi = ReturnType<typeof createRealApi>;

export function createMockApi(): RhApi {
  return {
    auth: mockAuthApi,
    org: mockOrgApi,
    overview: mockOverviewApi,
    employees: mockEmployeesApi,
    schedules: mockSchedulesApi,
    timesheets: mockTimesheetsApi,
    adjustments: mockAdjustmentsApi,
    absences: mockAbsencesApi,
    certificates: mockCertificatesApi,
    vacations: mockVacationsApi,
    closings: mockClosingsApi,
    timeBank: mockTimeBankApi,
    employeePortal: mockEmployeePortalApi,
    devices: mockDevicesApi,
    admin: mockAdminApi,
    superAdmin: mockSuperAdminApi,
    organization: mockOrganizationApi,
    invites: mockInvitesApi,
  };
}

export function createRhApi(client?: ApiClient, mocks = useMocks()): RhApi {
  return mocks ? createMockApi() : createRealApi(client);
}
