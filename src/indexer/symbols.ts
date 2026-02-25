/**
 * Regex-based symbol extraction per language.
 * No AST, no tree-sitter, no new dependencies.
 */

// ============================================================================
// Types
// ============================================================================

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method' | 'export';
  lineStart: number;
  lineEnd: number | null;
  signature: string | null;
  docComment: string | null;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Extract symbols from source code content.
 */
export function extractSymbols(content: string, language: string): ExtractedSymbol[] {
  const lines = content.split('\n');

  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractTSJS(lines);
    case 'python':
      return extractPython(lines);
    case 'rust':
      return extractRust(lines);
    case 'go':
      return extractGo(lines);
    case 'java':
      return extractJavaCSharp(lines);
    case 'csharp':
      return extractJavaCSharp(lines);
    case 'ruby':
      return extractRuby(lines);
    case 'c':
    case 'cpp':
      return extractCCpp(lines);
    default:
      return [];
  }
}

// ============================================================================
// TS/JS Extraction (Tier 1)
// ============================================================================

const TS_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  // function declarations
  { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
  // arrow function as const/let/var
  { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/, kind: 'function' },
  // class declarations
  { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
  // interface declarations
  { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
  // type alias
  { regex: /^(?:export\s+)?type\s+(\w+)\s*(?:=|<)/, kind: 'type' },
  // enum
  { regex: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/, kind: 'enum' },
  // exported const (non-arrow)
  { regex: /^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?!.*=>)/, kind: 'const' },
];

// Method pattern matched separately against the original (indented) line
const TS_METHOD_REGEX = /^\s+(?:(?:public|private|protected|static|async|abstract|readonly|override|get|set)\s+)*(\w+)\s*\(/;
const TS_METHOD_FALSE_POSITIVES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'import', 'from', 'require', 'super', 'this', 'constructor']);

function extractTSJS(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Skip comments and empty lines
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '') continue;

    let matched = false;
    for (const { regex, kind } of TS_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          kind,
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
        matched = true;
        break;
      }
    }

    // Try method pattern against original line (needs indentation)
    if (!matched) {
      const methodMatch = line.match(TS_METHOD_REGEX);
      if (methodMatch && methodMatch[1] && !TS_METHOD_FALSE_POSITIVES.has(methodMatch[1])) {
        symbols.push({
          name: methodMatch[1],
          kind: 'method',
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
      }
    }
  }

  return symbols;
}

// ============================================================================
// Python Extraction (Tier 1)
// ============================================================================

const PY_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'function' },
  { regex: /^class\s+(\w+)/, kind: 'class' },
];

function extractPython(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Check for decorator (capture it for context)
    let decoratorLine: number | null = null;
    if (i > 0 && lines[i - 1].trimStart().startsWith('@')) {
      decoratorLine = i; // note: decorator is above
    }

    for (const { regex, kind } of PY_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        // Determine if it's a method (indented def inside class)
        const indent = line.length - trimmed.length;
        const actualKind = (kind === 'function' && indent > 0) ? 'method' : kind;

        symbols.push({
          name: match[1],
          kind: actualKind,
          lineStart: decoratorLine ?? (i + 1),
          lineEnd: findIndentEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractPythonDocstring(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// Rust Extraction (Tier 1)
// ============================================================================

const RUST_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)/, kind: 'function' },
  { regex: /^(?:pub(?:\(crate\))?\s+)?struct\s+(\w+)/, kind: 'class' },
  { regex: /^(?:pub(?:\(crate\))?\s+)?enum\s+(\w+)/, kind: 'enum' },
  { regex: /^(?:pub(?:\(crate\))?\s+)?trait\s+(\w+)/, kind: 'interface' },
  { regex: /^(?:pub(?:\(crate\))?\s+)?type\s+(\w+)/, kind: 'type' },
  { regex: /^impl(?:<[^>]*>)?\s+(\w+)/, kind: 'class' },
];

function extractRust(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('//') || trimmed === '') continue;

    for (const { regex, kind } of RUST_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          kind,
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractRustDocComment(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// Go Extraction (Tier 1)
// ============================================================================

const GO_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/, kind: 'function' },
  { regex: /^type\s+(\w+)\s+struct\b/, kind: 'class' },
  { regex: /^type\s+(\w+)\s+interface\b/, kind: 'interface' },
  { regex: /^type\s+(\w+)\s+/, kind: 'type' },
];

function extractGo(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('//') || trimmed === '') continue;

    for (const { regex, kind } of GO_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        // For Go methods (receiver functions), mark as method
        const isMethod = kind === 'function' && /^func\s+\(/.test(trimmed);
        symbols.push({
          name: match[1],
          kind: isMethod ? 'method' : kind,
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// Java / C# Extraction (Tier 2)
// ============================================================================

const JAVA_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*class\s+(\w+)/, kind: 'class' },
  { regex: /^(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*interface\s+(\w+)/, kind: 'interface' },
  { regex: /^(?:(?:public|private|protected|static|final|abstract|synchronized|native|override|virtual|async)\s+)*(?:[\w<>\[\],\s]+)\s+(\w+)\s*\(/, kind: 'function' },
];

function extractJavaCSharp(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '') continue;
    // Skip import/using/package
    if (trimmed.startsWith('import ') || trimmed.startsWith('using ') || trimmed.startsWith('package ')) continue;

    for (const { regex, kind } of JAVA_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new'].includes(match[1])) continue;
        symbols.push({
          name: match[1],
          kind,
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// Ruby Extraction (Tier 2)
// ============================================================================

const RUBY_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^class\s+(\w+)/, kind: 'class' },
  { regex: /^module\s+(\w+)/, kind: 'class' },
  { regex: /^\s*def\s+(?:self\.)?(\w+[?!]?)/, kind: 'function' },
];

function extractRuby(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('#') || trimmed === '') continue;

    for (const { regex, kind } of RUBY_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        const indent = line.length - trimmed.length;
        const actualKind = (kind === 'function' && indent > 0) ? 'method' : kind;
        symbols.push({
          name: match[1],
          kind: actualKind,
          lineStart: i + 1,
          lineEnd: findRubyEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// C/C++ Extraction (Tier 2)
// ============================================================================

const C_PATTERNS: Array<{ regex: RegExp; kind: ExtractedSymbol['kind'] }> = [
  { regex: /^(?:class|struct)\s+(\w+)/, kind: 'class' },
  { regex: /^enum\s+(?:class\s+)?(\w+)/, kind: 'enum' },
  // function: return_type name(
  { regex: /^(?:(?:static|inline|extern|virtual|const|unsigned|signed|volatile)\s+)*(?:[\w:*&<>]+)\s+(\w+)\s*\(/, kind: 'function' },
];

function extractCCpp(lines: string[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '') continue;
    if (trimmed.startsWith('#')) continue; // preprocessor directives

    for (const { regex, kind } of C_PATTERNS) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'delete', 'sizeof'].includes(match[1])) continue;
        symbols.push({
          name: match[1],
          kind,
          lineStart: i + 1,
          lineEnd: findBraceEnd(lines, i),
          signature: trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200),
          docComment: extractDocComment(lines, i),
        });
        break;
      }
    }
  }

  return symbols;
}

// ============================================================================
// Line-End Detection Helpers
// ============================================================================

/** Scan forward from a declaration tracking brace depth. Cap at 500 lines. */
function findBraceEnd(lines: string[], startLine: number): number | null {
  let depth = 0;
  let foundOpen = false;
  const maxScan = Math.min(startLine + 500, lines.length);

  for (let i = startLine; i < maxScan; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { depth++; foundOpen = true; }
      else if (ch === '}') { depth--; }
    }
    if (foundOpen && depth <= 0) {
      return i + 1;
    }
  }

  return foundOpen ? startLine + 1 : null;
}

/** Scan forward for Python-style indentation-based end. Cap at 500 lines. */
function findIndentEnd(lines: string[], startLine: number): number | null {
  if (startLine >= lines.length) return null;

  const defLine = lines[startLine];
  const baseIndent = defLine.length - defLine.trimStart().length;
  const maxScan = Math.min(startLine + 500, lines.length);
  let lastContentLine = startLine;

  for (let i = startLine + 1; i < maxScan; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // skip blank lines

    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) {
      return lastContentLine + 1;
    }
    lastContentLine = i;
  }

  return lastContentLine + 1;
}

/** Scan forward for Ruby-style end keyword. Cap at 500 lines. */
function findRubyEnd(lines: string[], startLine: number): number | null {
  let depth = 1;
  const maxScan = Math.min(startLine + 500, lines.length);

  for (let i = startLine + 1; i < maxScan; i++) {
    const trimmed = lines[i].trimStart();
    if (/^(class|module|def|do|if|unless|while|until|for|case|begin)\b/.test(trimmed)) depth++;
    if (/^\s*end\b/.test(lines[i])) {
      depth--;
      if (depth <= 0) return i + 1;
    }
  }

  return null;
}

// ============================================================================
// Doc Comment Extraction
// ============================================================================

/** Extract JSDoc/C-style doc comment above a line. */
function extractDocComment(lines: string[], lineIdx: number): string | null {
  const commentLines: string[] = [];

  for (let i = lineIdx - 1; i >= 0 && i >= lineIdx - 30; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('/**') || trimmed.startsWith('*/')) {
      commentLines.unshift(trimmed);
    } else if (trimmed.startsWith('//')) {
      commentLines.unshift(trimmed);
    } else if (trimmed === '') {
      // Allow one blank line gap
      if (commentLines.length > 0) break;
    } else {
      break;
    }
  }

  if (commentLines.length === 0) return null;
  return commentLines.join('\n');
}

/** Extract Python docstring below a def/class line. */
function extractPythonDocstring(lines: string[], lineIdx: number): string | null {
  // Look for triple-quoted string in the lines immediately following
  for (let i = lineIdx + 1; i < Math.min(lineIdx + 3, lines.length); i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const quote = trimmed.substring(0, 3);
      // Single-line docstring
      if (trimmed.length > 3 && trimmed.endsWith(quote)) {
        return trimmed.slice(3, -3).trim();
      }
      // Multi-line
      const docLines = [trimmed.slice(3)];
      for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
        const line = lines[j].trimStart();
        if (line.includes(quote)) {
          docLines.push(line.replace(quote, ''));
          return docLines.join('\n').trim();
        }
        docLines.push(line);
      }
    }
    if (trimmed !== '' && !trimmed.startsWith('#')) break;
  }

  // Also check for # comments above
  return extractDocComment(lines, lineIdx);
}

/** Extract Rust /// doc comments above a line. */
function extractRustDocComment(lines: string[], lineIdx: number): string | null {
  const commentLines: string[] = [];

  for (let i = lineIdx - 1; i >= 0 && i >= lineIdx - 30; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('///') || trimmed.startsWith('//!')) {
      commentLines.unshift(trimmed);
    } else if (trimmed.startsWith('#[')) {
      commentLines.unshift(trimmed); // attribute, include
    } else if (trimmed === '') {
      if (commentLines.length > 0) break;
    } else {
      break;
    }
  }

  if (commentLines.length === 0) return null;
  return commentLines.join('\n');
}
