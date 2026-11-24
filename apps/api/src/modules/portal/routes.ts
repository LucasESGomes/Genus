/** Módulos do portal de RH, registrados sob /portal (app.ts). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { absenceRoutes } from '../absences/routes';
import { adjustmentRoutes } from '../adjustments/routes';
import { certificateRoutes } from '../certificates/routes';
import { closingRoutes } from '../closing/routes';
import { employeePortalRoutes } from '../employee-portal/routes';
import { employeeRoutes } from '../employees/routes';
import { facialRoutes } from '../facial/routes';
import { scheduleRoutes } from '../schedules/routes';
import { vacationRoutes } from '../vacations/routes';
import { timesheetRoutes } from '../timesheets/routes';
import type { PortalDeps } from './deps';

export const portalRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  await app.register(employeeRoutes, deps);
  await app.register(scheduleRoutes, deps);
  await app.register(timesheetRoutes, deps);
  await app.register(adjustmentRoutes, deps);
  await app.register(absenceRoutes, deps);
  await app.register(certificateRoutes, deps);
  await app.register(vacationRoutes, deps);
  await app.register(closingRoutes, deps);
  await app.register(employeePortalRoutes, deps);
  await app.register(facialRoutes, deps);
};
