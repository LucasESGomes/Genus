import { describe, expect, it } from 'vitest';
import { framingFromFaceRatio, isStill, nextStillCount } from './captureGuide';

describe('captureGuide', () => {
  it.each([[0.1, 'far'], [0.18, 'good'], [0.3, 'good'], [0.4, 'good'], [0.45, 'close']] as const)('rosto com %s da largura é %s', (ratio, expected) => {
    expect(framingFromFaceRatio(ratio)).toBe(expected);
  });

  it('parado = centro quase não andou; sem leitura anterior nunca está parado', () => {
    const box = { x: 400, y: 200, width: 300, height: 300 };
    expect(isStill(null, box, 1280)).toBe(false);
    expect(isStill(box, { ...box, x: 410 }, 1280)).toBe(true);
    expect(isStill(box, { ...box, x: 520 }, 1280)).toBe(false);
  });

  it('qualquer leitura ruim zera a contagem da foto automática', () => {
    expect(nextStillCount(2, true, true)).toBe(3);
    expect(nextStillCount(2, true, false)).toBe(0);
    expect(nextStillCount(2, false, true)).toBe(0);
  });
});
