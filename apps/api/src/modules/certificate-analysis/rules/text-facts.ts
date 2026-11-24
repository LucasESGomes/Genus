/**
 * Leitura por regras (regex) do texto do atestado: datas, período, profissional,
 * CRM e marcas de ilegibilidade. É a base das verificações determinísticas e do
 * provedor mock. Não decide nada: só diz o que achou e onde.
 */
import { dayNumber, type CivilDate } from '../../rules-common/rules/civil-time';

export interface FoundDate {
  date: CivilDate;
  /** Trecho do texto de onde a data saiu. */
  raw: string;
  index: number;
}

export interface TextFacts {
  dates: FoundDate[];
  /** Data em que o atestado foi emitido (linha "Data:" ou "<cidade>, dd de mês de aaaa"), se achada. */
  issueDate: FoundDate | null;
  /** "por N dias", "N (extenso) dias". */
  days: { value: number; raw: string; words: number | null } | null;
  hours: { value: number; raw: string } | null;
  /** "de dd/mm/aaaa a dd/mm/aaaa". */
  range: { start: CivilDate; end: CivilDate; raw: string } | null;
  doctor: { raw: string } | null;
  crm: { number: string; uf: string | null; raw: string; wellFormed: boolean } | null;
  /** Quantas marcas de leitura ruim: "[ilegível]", "???", "###", "░▒▓█". */
  illegibleMarks: number;
  /** Trechos ilegíveis perto de cada rótulo (data, período, profissional). */
  illegibleNear: { date: boolean; period: boolean; doctor: boolean };
  /** Data com caractere trocado pelo OCR (ex.: 1O/11/2026). */
  ambiguousDates: { raw: string; readings: CivilDate[] }[];
}

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
};

export const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const ILLEGIBLE_RE = /\[ileg[ií]vel\]|\?{3,}|#{3,}|[░▒▓█]+/giu;

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function toCivil(y: number, m: number, d: number): CivilDate | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as CivilDate;
  try {
    dayNumber(s);
    return s;
  } catch {
    return null;
  }
}

const NUMERIC_DATE_RE = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g;
const LONG_DATE_RE = /(?<!\d)(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})(?!\d)/gi;
// Data com O/I/l no lugar de dígito: só para listar leituras possíveis.
const FUZZY_DATE_RE = /(?<![\p{L}\p{N}])([\dOIl]{1,2})[/.-]([\dOIl]{1,2})[/.-]([\dOIl]{4})(?![\p{L}\p{N}])/gu;

function allDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(NUMERIC_DATE_RE)) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = toCivil(year, Number(m[2]), Number(m[1]));
    if (date) out.push({ date, raw: m[0], index: m.index! });
  }
  for (const m of text.matchAll(LONG_DATE_RE)) {
    const month = MONTHS[plain(m[2]!)];
    const date = month ? toCivil(Number(m[3]), month, Number(m[1])) : null;
    if (date) out.push({ date, raw: m[0], index: m.index! });
  }
  return out.sort((a, b) => a.index - b.index);
}

function ambiguousDates(text: string): { raw: string; readings: CivilDate[] }[] {
  const out: { raw: string; readings: CivilDate[] }[] = [];
  for (const m of text.matchAll(FUZZY_DATE_RE)) {
    if (!/[OIl]/.test(m[0])) continue;
    const fix = (s: string) => s.replace(/O/g, '0').replace(/[Il]/g, '1');
    const reading = toCivil(Number(fix(m[3]!)), Number(fix(m[2]!)), Number(fix(m[1]!)));
    // "1O" pode ser 10 (O→0) ou 1 seguido de lixo: a segunda leitura tira o caractere trocado.
    const drop = (s: string) => s.replace(/[OIl]/g, '');
    const alt = toCivil(Number(fix(m[3]!)), Number(drop(m[2]!) || '0'), Number(drop(m[1]!) || '0'));
    const readings = [...new Set([reading, alt].filter((d): d is CivilDate => d !== null))];
    if (readings.length > 0) out.push({ raw: m[0], readings });
  }
  return out;
}

/** Janela de texto depois de um rótulo, para checar ilegibilidade perto dele. */
function near(text: string, label: RegExp, size = 60): string | null {
  const m = label.exec(text);
  return m ? text.slice(m.index, m.index + m[0].length + size) : null;
}

const hasIllegible = (s: string | null) => s !== null && new RegExp(ILLEGIBLE_RE.source, 'iu').test(s);

export function extractTextFacts(text: string): TextFacts {
  const dates = allDates(text);
  const p = plain(text);

  // Emissão: "Data: dd/mm/aaaa" ou "<Cidade>, dd de mês de aaaa" (o mais comum no rodapé).
  const dataLabel = /\bdata(?:\s+de\s+emiss[aã]o)?\s*:\s*/i.exec(text);
  let issueDate: FoundDate | null = null;
  if (dataLabel) issueDate = dates.find((d) => d.index >= dataLabel.index && d.index - dataLabel.index < 40) ?? null;
  issueDate ??= dates.find((d) => /de\s+[a-zç]+\s+de/i.test(d.raw) && /,\s*$/.test(text.slice(Math.max(0, d.index - 3), d.index))) ?? null;

  let days: TextFacts['days'] = null;
  const daysRe = /(\d{1,3})\s*(?:\(\s*([a-zà-ú]+(?:\s+e\s+[a-zà-ú]+)?)\s*\)\s*)?dias?\b/i;
  const dm = daysRe.exec(text);
  if (dm) {
    let words: number | null = null;
    if (dm[2]) {
      const parts = plain(dm[2]).split(/\s+e\s+/);
      const values = parts.map((w) => NUMBER_WORDS[w]);
      words = values.every((v) => v !== undefined) ? values.reduce((s, v) => s + (v as number), 0) : null;
    }
    days = { value: Number(dm[1]), raw: dm[0], words };
  } else {
    const wordOnly = /\b(?:por|durante)\s+([a-z]+)\s+dias?\b/.exec(p);
    const v = wordOnly ? NUMBER_WORDS[wordOnly[1]!] : undefined;
    if (wordOnly && v !== undefined) days = { value: v, raw: wordOnly[0], words: v };
  }

  const hm = /(\d{1,2})\s*(?:h\b|horas?\b)/i.exec(text);
  const hours = hm ? { value: Number(hm[1]), raw: hm[0] } : null;

  let range: TextFacts['range'] = null;
  const rangeRe = /\b(?:de|desde)\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(?:a|at[eé])\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i;
  const rm = rangeRe.exec(text);
  if (rm) {
    const [a, b] = [allDates(rm[1]!)[0], allDates(rm[2]!)[0]];
    if (a && b) range = { start: a.date, end: b.date, raw: rm[0] };
  }

  // Título em qualquer caixa inicial ("Dr.", "dra", "Médica"); o nome começa com maiúscula.
  // Só espaço/tab entre as partes do nome: a quebra de linha encerra o nome.
  const docRe = /\b(?:[Dd]ra?\.?|[Dd]outora?|[Mm][eé]dic[oa])[ \t]+([A-ZÀ-Ú][\p{L}'-]+(?:[ \t]+(?:d[aeo]s?[ \t]+)?[A-ZÀ-Ú][\p{L}'-]+)*)/u;
  const doc = docRe.exec(text);
  const doctor = doc ? { raw: doc[0] } : null;

  let crm: TextFacts['crm'] = null;
  const crmRe = /\bCRM\s*[-/:]?\s*([A-Z]{2})?\s*[-/:]?\s*([0-9A-Za-z.]{1,10})(?:\s*[-/]\s*([A-Z]{2}))?/;
  const cm = crmRe.exec(text);
  if (cm) {
    const uf = (cm[1] ?? cm[3] ?? null)?.toUpperCase() ?? null;
    const number = cm[2]!.replace(/\./g, '');
    crm = { number, uf, raw: cm[0].trim(), wellFormed: /^\d{3,8}$/.test(number) && uf !== null && UFS.has(uf) };
  }

  const illegibleMarks = [...text.matchAll(ILLEGIBLE_RE)].length;
  return {
    dates,
    issueDate,
    days,
    hours,
    range,
    doctor,
    crm,
    illegibleMarks,
    illegibleNear: {
      date: hasIllegible(near(text, /\bdata\b/i)),
      period: hasIllegible(near(text, /\b(?:afastamento|repouso|dias?)\b/i)),
      doctor: hasIllegible(near(text, /\b(?:dra?\.?|crm)\b/i)),
    },
    ambiguousDates: ambiguousDates(text),
  };
}
