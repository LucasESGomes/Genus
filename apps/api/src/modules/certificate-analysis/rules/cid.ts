/**
 * Extração e interpretação do CID-10 (RF32, RF61). Dado de saúde: o resultado
 * só vai para o RH e é gravado cifrado.
 *
 * A interpretação é pelo CAPÍTULO da CID-10 (tabela fixa da OMS/DATASUS), não
 * pelo diagnóstico: o sistema não inventa descrição de doença. Código bem
 * formado fora das faixas dos capítulos vira `fora_da_tabela`.
 *
 * Leitura ambígua (OCR troca O por 0, I/l por 1, S por 5): cada leitura possível
 * vira uma hipótese, com confiança menor que a de um código lido limpo.
 */

export interface CidChapter {
  chapter: string;
  title: string;
  from: string;
  to: string;
}

/** CID-10, capítulos I a XXII. `from`/`to` = categoria de 3 caracteres, inclusiva. */
export const CID10_CHAPTERS: readonly CidChapter[] = [
  { chapter: 'I', from: 'A00', to: 'B99', title: 'Algumas doenças infecciosas e parasitárias' },
  { chapter: 'II', from: 'C00', to: 'D48', title: 'Neoplasias (tumores)' },
  { chapter: 'III', from: 'D50', to: 'D89', title: 'Doenças do sangue e dos órgãos hematopoéticos e alguns transtornos imunitários' },
  { chapter: 'IV', from: 'E00', to: 'E90', title: 'Doenças endócrinas, nutricionais e metabólicas' },
  { chapter: 'V', from: 'F00', to: 'F99', title: 'Transtornos mentais e comportamentais' },
  { chapter: 'VI', from: 'G00', to: 'G99', title: 'Doenças do sistema nervoso' },
  { chapter: 'VII', from: 'H00', to: 'H59', title: 'Doenças do olho e anexos' },
  { chapter: 'VIII', from: 'H60', to: 'H95', title: 'Doenças do ouvido e da apófise mastoide' },
  { chapter: 'IX', from: 'I00', to: 'I99', title: 'Doenças do aparelho circulatório' },
  { chapter: 'X', from: 'J00', to: 'J99', title: 'Doenças do aparelho respiratório' },
  { chapter: 'XI', from: 'K00', to: 'K93', title: 'Doenças do aparelho digestivo' },
  { chapter: 'XII', from: 'L00', to: 'L99', title: 'Doenças da pele e do tecido subcutâneo' },
  { chapter: 'XIII', from: 'M00', to: 'M99', title: 'Doenças do sistema osteomuscular e do tecido conjuntivo' },
  { chapter: 'XIV', from: 'N00', to: 'N99', title: 'Doenças do aparelho geniturinário' },
  { chapter: 'XV', from: 'O00', to: 'O99', title: 'Gravidez, parto e puerpério' },
  { chapter: 'XVI', from: 'P00', to: 'P96', title: 'Algumas afecções originadas no período perinatal' },
  { chapter: 'XVII', from: 'Q00', to: 'Q99', title: 'Malformações congênitas, deformidades e anomalias cromossômicas' },
  { chapter: 'XVIII', from: 'R00', to: 'R99', title: 'Sintomas, sinais e achados anormais de exames clínicos e de laboratório' },
  { chapter: 'XIX', from: 'S00', to: 'T98', title: 'Lesões, envenenamento e algumas outras consequências de causas externas' },
  { chapter: 'XX', from: 'V01', to: 'Y98', title: 'Causas externas de morbidade e de mortalidade' },
  { chapter: 'XXI', from: 'Z00', to: 'Z99', title: 'Fatores que influenciam o estado de saúde e o contato com os serviços de saúde' },
  { chapter: 'XXII', from: 'U00', to: 'U99', title: 'Códigos para propósitos especiais' },
];

export interface CidInterpretation {
  code: string;
  /** Capítulo romano, ou null se o código não cai em nenhuma faixa. */
  chapter: string | null;
  chapterTitle: string | null;
  status: 'valido' | 'fora_da_tabela';
}

export interface CidCandidate extends CidInterpretation {
  confidence: number;
  /** Lido do texto pelas regras ou sugerido pela IA. */
  source: 'regra' | 'ia';
}

const CODE_RE = /^([A-Z])(\d{2})(?:\.(\d))?$/;

/** Normaliza `j11.1`, `J 11.1`, `J111` para `J11.1`. Null se não for CID-10 bem formado. */
export function normalizeCid(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z])(\d{2})\.?(\d)?$/.exec(compact);
  if (!m) return null;
  return m[3] ? `${m[1]}${m[2]}.${m[3]}` : `${m[1]}${m[2]}`;
}

export function interpretCid(code: string): CidInterpretation {
  const m = CODE_RE.exec(code);
  if (!m) return { code, chapter: null, chapterTitle: null, status: 'fora_da_tabela' };
  const category = `${m[1]}${m[2]}`;
  const ch = CID10_CHAPTERS.find((c) => category >= c.from && category <= c.to);
  return ch
    ? { code, chapter: ch.chapter, chapterTitle: ch.title, status: 'valido' }
    : { code, chapter: null, chapterTitle: null, status: 'fora_da_tabela' };
}

// Rótulo "CID", "CID-10", "CID 10:" seguido do código, que pode vir com confusões de OCR.
const LABELLED_RE = /\bCID(?:[\s-]*10)?\s*[:.-]?\s*([A-Z0-9][\s]?[0-9OIlS]{2}(?:\.[0-9OIlS])?)/gi;
// Código solto (sem rótulo): só a forma limpa, para não confundir com outra sigla.
const BARE_RE = /(?<![\p{L}\p{N}])([A-Z]\d{2}(?:\.\d)?)(?![\p{L}\p{N}])/gu;

const DIGIT_CONFUSIONS: Record<string, string> = { O: '0', I: '1', l: '1', S: '5' };
const LETTER_CONFUSIONS: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S' };

/** Leituras possíveis de um código com caracteres trocados pelo OCR. */
function readings(raw: string): { code: string; exact: boolean }[] {
  const s = raw.replace(/\s+/g, '');
  const first = s[0]!;
  const letters = /[A-Za-z]/.test(first) ? [first.toUpperCase()] : LETTER_CONFUSIONS[first] ? [LETTER_CONFUSIONS[first]!] : [];
  const rest = [...s.slice(1)].map((ch) => (ch === '.' ? '.' : /\d/.test(ch) ? ch : (DIGIT_CONFUSIONS[ch] ?? ch))).join('');
  const exact = /[A-Za-z]/.test(first) && /^\d{2}(\.\d)?$/.test(s.slice(1));
  const out: { code: string; exact: boolean }[] = [];
  for (const letter of letters) {
    const code = normalizeCid(`${letter}${rest}`);
    if (code) out.push({ code, exact });
  }
  return out;
}

/** Candidatos a CID no texto, do mais para o menos confiável, sem repetição. */
export function extractCidCandidates(text: string): CidCandidate[] {
  const found = new Map<string, CidCandidate>();
  const add = (code: string, confidence: number) => {
    const prev = found.get(code);
    if (!prev || prev.confidence < confidence) found.set(code, { ...interpretCid(code), confidence, source: 'regra' });
  };
  for (const m of text.matchAll(LABELLED_RE)) {
    const options = readings(m[1]!);
    for (const r of options) add(r.code, r.exact ? 0.9 : options.length > 1 ? 0.4 : 0.6);
  }
  for (const m of text.matchAll(BARE_RE)) {
    if (found.has(m[1]!)) continue;
    // Sem rótulo, o código pode ser outra coisa (sala A12, lote B03): confiança baixa.
    add(m[1]!, 0.35);
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence || a.code.localeCompare(b.code));
}
