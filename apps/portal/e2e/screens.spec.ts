/**
 * Percorre as telas por papel, em 1440 e 360 px: captura (test/screens/, fora do git) e mede
 * contraste e demais regras WCAG 2 AA com axe. Modo mock: a sessão é posta direto no sessionStorage.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

type Role = 'rh' | 'admin' | 'gestor' | 'contador' | 'colaborador';

const ROUTES: Record<Role, string[]> = {
  rh: ['/rh', '/rh/colaboradores', '/rh/colaboradores/102', '/rh/apuracao', '/rh/escalas', '/rh/ajustes', '/rh/ferias', '/rh/atestados', '/rh/banco-horas', '/rh/fechamento', '/rh/relatorios', '/rh/totens', '/rh/totens/1', '/rh/configuracoes'],
  admin: ['/rh', '/rh/atestados', '/rh/totens'],
  gestor: ['/rh', '/rh/atestados', '/rh/ajustes', '/rh/fechamento'],
  contador: ['/rh/fechamento', '/rh/colaboradores'],
  colaborador: ['/me', '/me/espelho', '/me/ferias', '/me/atestado'],
};

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '360', width: 360, height: 780 },
];

async function signIn(page: Page, role: Role) {
  await page.addInitScript((r) => window.sessionStorage.setItem('genus.mock.session', JSON.stringify({ role: r, pending2fa: false })), role);
}

const slug = (route: string) => route.replace(/^\//, '').replace(/\//g, '_') || 'raiz';

for (const vp of VIEWPORTS) {
  for (const [role, routes] of Object.entries(ROUTES) as [Role, string[]][]) {
    for (const route of routes) {
      test(`${vp.name} ${role} ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await signIn(page, role);
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Carregando', { exact: false }).first()).toBeHidden({ timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(800);
        await page.screenshot({ path: `test/screens/${vp.name}/${role}-${slug(route)}.png`, fullPage: true });
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('nextjs-portal').analyze();
        const summary = axe.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
        test.info().annotations.push({ type: 'axe', description: summary.join('\n') || 'ok' });
        expect(summary, `violações axe em ${route} (${role}, ${vp.name})`).toEqual([]);
      });
    }
  }
}
