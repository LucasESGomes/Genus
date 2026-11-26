/** Módulos do portal de RH, registrados sob /portal (app.ts). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { absenceRoutes } from '../absences/routes';
import { adjustmentRoutes } from '../adjustments/routes';
import { certificateAnalysisRoutes } from '../certificate-analysis/routes';
import { certificateRoutes } from '../certificates/routes';
import { closingRoutes } from '../closing/routes';
import { deviceRoutes } from '../devices/routes';
import { employeePortalRoutes } from '../employee-portal/routes';
import { employeeRoutes } from '../employees/routes';
import { establishmentRoutes } from '../establishments/routes';
import { facialRoutes } from '../facial/routes';
import { holidayRoutes } from '../holidays/routes';
import { inviteRoutes } from '../invites/routes';
import { orgUnitRoutes } from '../org-units/routes';
import { scheduleRoutes } from '../schedules/routes';
import { superAdminRoutes } from '../super-admin/routes';
import { timeBankRoutes } from '../time-bank/routes';
import { totemRoutes } from '../totem/routes';
import { vacationRoutes } from '../vacations/routes';
import { timesheetRoutes } from '../timesheets/routes';
import type { PortalDeps } from './deps';

export const portalRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  await app.register(employeeRoutes, deps);
  await app.register(scheduleRoutes, deps);
  await app.register(timesheetRoutes, deps);
  await app.register(timeBankRoutes, deps);
  await app.register(adjustmentRoutes, deps);
  await app.register(absenceRoutes, deps);
  await app.register(certificateRoutes, deps);
  await app.register(certificateAnalysisRoutes, deps);
  await app.register(vacationRoutes, deps);
  await app.register(closingRoutes, deps);
  await app.register(employeePortalRoutes, deps);
  await app.register(facialRoutes, deps);
  await app.register(deviceRoutes, deps);
  await app.register(totemRoutes, deps);
  await app.register(establishmentRoutes, deps);
  await app.register(inviteRoutes, deps);
  await app.register(orgUnitRoutes, deps);
  await app.register(holidayRoutes, deps);
  // Escopo próprio: a guarda super_admin (onRequest) vale só aqui dentro. O prefixo fica no escopo de
  // fora: os submódulos recebem as mesmas opções, e um `prefix` nelas seria aplicado duas vezes.
  const superAdmin = deps.superAdmin;
  if (superAdmin) await app.register(async (scope) => scope.register(superAdminRoutes, superAdmin), { prefix: '/super-admin' });
};
