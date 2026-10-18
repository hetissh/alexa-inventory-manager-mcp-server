// Turns spoken or typed names into a canonical token list so "Air Filters", "air filter" and
// "compressor two" / "Compressor 2" compare equal. Applied identically to queries and to stored names.

const DIGIT_WORDS = new Map<string, string>([
  ['zero', '0'],
  ['oh', '0'],
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
]);

const TEENS = new Map<string, number>([
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
]);

const TENS = new Map<string, number>([
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
]);

export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function isDigitWord(token: string | undefined): boolean {
  return token !== undefined && DIGIT_WORDS.has(token);
}

/** "one oh eight" -> "108", "twenty five" -> "25", "fourteen" -> "14". A lone "oh" is left alone. */
function convertNumberWords(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let resumeAt = 0;
  for (const [index, token] of tokens.entries()) {
    if (index < resumeAt) {
      continue;
    }
    const tens = TENS.get(token);
    if (tens !== undefined) {
      const next = tokens[index + 1];
      const unit = next === undefined ? undefined : DIGIT_WORDS.get(next);
      if (unit !== undefined && unit !== '0') {
        out.push(String(tens + Number(unit)));
        resumeAt = index + 2;
      } else {
        out.push(String(tens));
      }
      continue;
    }
    const teen = TEENS.get(token);
    if (teen !== undefined) {
      out.push(String(teen));
      continue;
    }
    if (isDigitWord(token)) {
      let end = index;
      while (isDigitWord(tokens[end])) {
        end += 1;
      }
      const run = tokens.slice(index, end);
      out.push(run.length === 1 && token === 'oh' ? 'oh' : run.map((word) => DIGIT_WORDS.get(word)).join(''));
      resumeAt = end;
      continue;
    }
    out.push(token);
  }
  return out;
}

/** Crude English singularisation; only needs to be consistent, not linguistically perfect. */
export function singularize(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) {
    return token;
  }
  if (token.endsWith('sses')) {
    return token.slice(0, -2);
  }
  if (/(ss|us|is)$/.test(token)) {
    return token;
  }
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (/(ch|sh|x|z)es$/.test(token)) {
    return token.slice(0, -2);
  }
  return token.endsWith('s') ? token.slice(0, -1) : token;
}

export function normalizeTokens(text: string): string[] {
  return convertNumberWords(tokenize(text)).map(singularize);
}

export function normalize(text: string): string {
  return normalizeTokens(text).join(' ');
}
