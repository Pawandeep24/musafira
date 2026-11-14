export interface TextRun {
  readonly text: string;
  readonly match: boolean;
}

const WORD = /([\p{L}\p{M}\p{N}]+)/u;

/** Splits `name` into runs, marking the start of each word that begins with one of the typed words. */
export function matchedRuns(name: string, typed: string): TextRun[] {
  const typedWords = typed
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return name
    .split(WORD)
    .filter(Boolean)
    .flatMap((token): TextRun[] => {
      const typedWord = typedWords.find((word) => token.toLowerCase().startsWith(word));
      if (!typedWord) return [{ text: token, match: false }];
      const rest = token.slice(typedWord.length);
      return [{ text: token.slice(0, typedWord.length), match: true }, ...(rest ? [{ text: rest, match: false }] : [])];
    });
}
