// A small syntax highlighter.
//
// Why hand-rolled rather than shiki/prism: the only source this ever renders is
// THIS repo's own files, embedded at build time. It is clean, it is known, and
// it is never user input — which is exactly the narrow case where a tokenizer is
// sufficient and a real parser is 200KB of insurance against a risk we don't
// have. The page has to stay snappy, and a highlighter is a lot of bytes to ship
// so a collapsed <details> can look right.
//
// The colours are Dark+ by eye, because that's the reference: "the JSON files in
// VS Code look better than how we are presenting the data." They do. Uncoloured
// monospace on dark is a wall, and the eye has nothing to grab.
//
// It returns tokens, not HTML — so React does the escaping and there is no
// dangerouslySetInnerHTML anywhere near a page about security.

export type TokenKind =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'type'
  | 'key'
  | 'punct'
  | 'plain'

export type Token = { text: string; kind: TokenKind }

/** Dark+ by eye. Punctuation recedes; the data is what should catch the eye. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'text-slate-500 italic',
  string: 'text-orange-300',
  keyword: 'text-purple-400',
  number: 'text-lime-300',
  type: 'text-teal-300',
  key: 'text-sky-300',
  punct: 'text-slate-500',
  plain: 'text-slate-300',
}

const KEYWORDS = new Set([
  'import', 'export', 'from', 'as', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'of', 'in', 'while', 'switch', 'case', 'break', 'continue',
  'type', 'interface', 'enum', 'class', 'extends', 'implements', 'new', 'this',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'void', 'null', 'undefined', 'true', 'false', 'default', 'public', 'private',
  'readonly', 'static', 'get', 'set', 'declare', 'namespace', 'satisfies',
])

// One pass, ordered by precedence. Comments must beat strings (a // inside a
// string is not a comment, but a string inside a comment is not a string), and
// both must beat everything else.
const TS_RE = new RegExp(
  [
    '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '(?<string>`(?:[^`\\\\]|\\\\.)*`|\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*")',
    '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?\\b)',
    '(?<word>[A-Za-z_$][\\w$]*)',
    '(?<punct>[{}()\\[\\].,;:=<>+\\-*/%&|!?^~]+)',
  ].join('|'),
  'g',
)

export function highlightTs(source: string): Token[] {
  const out: Token[] = []
  let last = 0

  for (const m of source.matchAll(TS_RE)) {
    const g = m.groups!
    if (m.index > last) out.push({ text: source.slice(last, m.index), kind: 'plain' })
    last = m.index + m[0].length

    if (g.comment) out.push({ text: g.comment, kind: 'comment' })
    else if (g.string) out.push({ text: g.string, kind: 'string' })
    else if (g.number) out.push({ text: g.number, kind: 'number' })
    else if (g.punct) out.push({ text: g.punct, kind: 'punct' })
    else if (g.word) {
      const kind: TokenKind = KEYWORDS.has(g.word)
        ? 'keyword'
        : // A leading capital is a type by convention here. Imperfect, and the
          // failure mode is a mis-coloured identifier, not a wrong page.
          /^[A-Z]/.test(g.word)
          ? 'type'
          : 'plain'
      out.push({ text: g.word, kind })
    }
  }

  if (last < source.length) out.push({ text: source.slice(last), kind: 'plain' })
  return out
}

const JSON_RE = new RegExp(
  [
    '(?<key>"(?:[^"\\\\]|\\\\.)*")(?=\\s*:)',
    '(?<string>"(?:[^"\\\\]|\\\\.)*")',
    '(?<number>-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',
    '(?<keyword>\\b(?:true|false|null)\\b)',
    '(?<punct>[{}\\[\\],:])',
  ].join('|'),
  'g',
)

/** JSON gets its own pass: a key is not a string, and colouring it so is the point. */
export function highlightJson(source: string): Token[] {
  const out: Token[] = []
  let last = 0

  for (const m of source.matchAll(JSON_RE)) {
    const g = m.groups!
    if (m.index > last) out.push({ text: source.slice(last, m.index), kind: 'plain' })
    last = m.index + m[0].length

    if (g.key) out.push({ text: g.key, kind: 'key' })
    else if (g.string) out.push({ text: g.string, kind: 'string' })
    else if (g.number) out.push({ text: g.number, kind: 'number' })
    else if (g.keyword) out.push({ text: g.keyword, kind: 'keyword' })
    else if (g.punct) out.push({ text: g.punct, kind: 'punct' })
  }

  if (last < source.length) out.push({ text: source.slice(last), kind: 'plain' })
  return out
}

/** Pick a pass from the file extension. Defaults to the TS one. */
export function highlight(source: string, file: string): Token[] {
  return file.endsWith('.json') ? highlightJson(source) : highlightTs(source)
}
