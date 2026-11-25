'use client';
import { useEffect, useState } from 'react';

/** Largura de 1024 px ou mais (duas colunas). Começa falso para o HTML do servidor casar com o do cliente. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return desktop;
}
