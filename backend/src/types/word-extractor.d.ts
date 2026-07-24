// word-extractor ships no type declarations. Minimal ambient module so the
// lazy `import('word-extractor')` in resumeText.service typechecks. Only the
// surface we use (new WordExtractor().extract(buffer).getBody()) is declared.
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
  }
  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }
}
