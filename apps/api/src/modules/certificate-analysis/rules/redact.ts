/**
 * Minimização antes do envio ao provedor de IA (LGPD art. 6º, III, e art. 11).
 * Sai do texto: qualquer CPF (com ou sem máscara) e o nome do colaborador,
 * completo ou por partes (sem diferenciar acento nem caixa). Fica o que a
 * análise precisa: datas, período, profissional, CRM e CID.
 *
 * Remover a mais é preferível a remover a menos: se o médico tiver o mesmo
 * sobrenome do colaborador, o sobrenome dele também sai.
 */

export const CPF_MARK = '[CPF]';
export const NAME_MARK = '[NOME]';

export interface RedactionResult {
  text: string;
  removed: { cpf: number; name: number };
}

// 000.000.000-00, 000 000 000 00, 00000000000. Não pega número dentro de número maior.
const CPF_RE = /(?<!\d)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?!\d)/g;

// Conectivos do nome que, sozinhos, não identificam ninguém.
const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del']);

const ACCENTS: Record<string, string> = {
  a: 'aáàâãä',
  e: 'eéèêë',
  i: 'iíìîï',
  o: 'oóòôõö',
  u: 'uúùûü',
  c: 'cç',
  n: 'nñ',
};

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Regex que casa a palavra com ou sem acento, em qualquer caixa. */
function looseWord(word: string): string {
  return [...stripAccents(word).toLowerCase()]
    .map((ch) => {
      const variants = ACCENTS[ch];
      if (variants) return `[${variants}${variants.toUpperCase()}]`;
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
}

const boundary = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');

export function redactPersonalData(text: string, person: { cpf: string; name: string }): RedactionResult {
  let cpf = 0;
  let name = 0;
  let out = text.replace(CPF_RE, () => {
    cpf += 1;
    return CPF_MARK;
  });

  const parts = person.name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !CONNECTORS.has(stripAccents(p).toLowerCase()));
  if (parts.length > 0) {
    // Nome completo (com espaços variáveis) antes das partes, para contar uma ocorrência só.
    const all = person.name.trim().split(/\s+/).map(looseWord).join('\\s+');
    out = out.replace(boundary(all), () => {
      name += 1;
      return NAME_MARK;
    });
    for (const part of [...parts].sort((a, b) => b.length - a.length)) {
      out = out.replace(boundary(looseWord(part)), () => {
        name += 1;
        return NAME_MARK;
      });
    }
    // "[NOME] [NOME]" vira um só marcador
    out = out.replace(/\[NOME\](?:\s+\[NOME\])+/g, NAME_MARK);
  }
  return { text: out, removed: { cpf, name } };
}

/** Confere que o texto não tem mais o CPF (só dígitos) nem partes do nome. Usado antes de enviar. */
export function containsPersonalData(text: string, person: { cpf: string; name: string }): boolean {
  const digits = text.replace(/\D/g, '');
  if (person.cpf.length === 11 && digits.includes(person.cpf)) return true;
  if (new RegExp(CPF_RE.source).test(text)) return true;
  const plain = stripAccents(text).toLowerCase();
  return person.name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !CONNECTORS.has(stripAccents(p).toLowerCase()))
    .some((p) => boundary(looseWord(p)).test(plain));
}
