'use client';
import { useEffect, useRef, useState } from 'react';

/** Devolve `value` só depois de `delayMs` sem mudança (padrão 300 ms). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Mínimo de caracteres para a busca ir à api (contrato: `q` de 2 a 100). */
export const MIN_SEARCH_CHARS = 2;

/**
 * Estado da busca por texto de uma tela. `text` é o que a pessoa digitou (estado de tela, NUNCA na URL:
 * nome é dado pessoal); `q` é o valor aparado e com debounce que vai para a api (`undefined` com menos de 2 caracteres);
 * `onQueryChange` roda quando `q` muda (use para voltar à página 1). `typing` é verdadeiro enquanto o debounce não alcançou o texto.
 */
export function useTextSearch(onQueryChange?: () => void, delayMs = 300) {
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text.trim().slice(0, 100), delayMs);
  const q = debounced.length >= MIN_SEARCH_CHARS ? debounced : undefined;
  const wanted = text.trim().slice(0, 100);
  // Quando o texto enviado muda (não na montagem), a tela volta para a página 1.
  const callback = useRef(onQueryChange);
  callback.current = onQueryChange;
  const previous = useRef(q);
  useEffect(() => {
    if (previous.current === q) return;
    previous.current = q;
    callback.current?.();
  }, [q]);
  const typing = (wanted.length >= MIN_SEARCH_CHARS ? wanted : '') !== (q ?? '');
  return { text, setText, q, typing };
}
