import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { navigationMock, setRoute } from './navigation';

expect.extend(axeMatchers);
// findBy*/waitFor: 1 s padrão é pouco com a suíte inteira em paralelo no jsdom.
configure({ asyncUtilTimeout: 5000 });

vi.mock('next/navigation', () => navigationMock);

// jsdom não tem estas APIs; Radix (shadcn) e recharts usam.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.setPointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  setRoute('/rh');
  window.sessionStorage.clear();
  window.localStorage.clear();
});
