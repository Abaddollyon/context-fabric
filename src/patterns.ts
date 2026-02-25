/**
 * CodePattern extractor
 * Learns patterns from stored memories and detects violations
 */

import { Memory, MemoryType, CodePattern } from './types.js';
import { ProjectMemoryLayer } from './layers/project.js';
import { SemanticMemoryLayer } from './layers/semantic.js';

export interface Violation {
  patternId: string;
  patternName: string;
  severity: 'warning' | 'error';
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface ExtractedPattern {
  name: string;
  description: string;
  code: string;
  language: string;
  confidence: number;
}

/**
 * PatternExtractor extracts and manages code patterns from memories
 */
export class PatternExtractor {
  private l2Layer?: ProjectMemoryLayer;
  private l3Layer?: SemanticMemoryLayer;
  private readonly logFn: (level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]) => void;

  constructor(
    l2Layer?: ProjectMemoryLayer,
    l3Layer?: SemanticMemoryLayer,
    logFn?: (level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]) => void,
  ) {
    this.l2Layer = l2Layer;
    this.l3Layer = l3Layer;
    this.logFn = logFn ?? ((level, ...args) => console.error(`[ContextFabric:${level}]`, ...args));
  }

  /**
   * Extract patterns from L2/L3 memories
   */
  async extractPatterns(projectPath?: string): Promise<CodePattern[]> {
    const patterns: CodePattern[] = [];

    // Extract from L2 if available
    if (this.l2Layer) {
      const codeMemories = await this.l2Layer.findByType('code_pattern');
      const conventionMemories = await this.l2Layer.findByType('convention');

      for (const memory of [...codeMemories, ...conventionMemories]) {
        const pattern = this.memoryToPattern(memory);
        if (pattern) {
          patterns.push(pattern);
        }
      }
    }

    // Extract from L3 if available
    if (this.l3Layer) {
      try {
        const semanticPatterns = await this.l3Layer.recall('code pattern convention', 20);

        for (const memory of semanticPatterns) {
          const pattern = this.memoryToPattern(memory);
          if (pattern) {
            patterns.push(pattern);
          }
        }
      } catch (err) {
        this.logFn('warn', 'L3 pattern extraction unavailable:', err);
      }
    }

    // Deduplicate by name
    const seen = new Set<string>();
    return patterns.filter((p) => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
  }

  /**
   * Detect when patterns are being violated
   */
  async checkViolation(fileContent: string, patterns?: CodePattern[]): Promise<Violation[]> {
    const violations: Violation[] = [];

    // Get patterns if not provided
    const patternsToCheck = patterns || (await this.extractPatterns());

    for (const pattern of patternsToCheck) {
      const patternViolations = this.checkPatternViolation(fileContent, pattern);
      violations.push(...patternViolations);
    }

    return violations;
  }

  /**
   * Learn a new pattern from code and description
   */
  async learnPattern(
    name: string,
    code: string,
    description: string,
    language: string,
    examples: string[] = []
  ): Promise<CodePattern> {
    const pattern: CodePattern = {
      id: `pattern_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      name,
      description,
      code,
      language,
      usageCount: 1,
      lastUsedAt: new Date(),
      relatedFiles: [],
    };

    // Store in appropriate layer
    if (this.l3Layer) {
      await this.l3Layer.store(
        JSON.stringify({
          pattern,
          examples,
          originalCode: code,
        }),
        'code_pattern',
        {
          patternName: name,
          language,
          tags: ['pattern', 'extracted', language.toLowerCase()],
        }
      );
    }

    return pattern;
  }

  /**
   * Convert a memory to a CodePattern
   */
  private memoryToPattern(memory: Memory): CodePattern | null {
    try {
      // Try to parse pattern from memory content
      let parsed: Record<string, unknown> | null = null;

      try {
        parsed = JSON.parse(memory.content);
      } catch {
        // Not JSON, use content as-is
      }

      if (parsed?.pattern) {
        const p = parsed.pattern as CodePattern;
        return {
          id: memory.id,
          name: p.name || 'Unnamed Pattern',
          description: p.description || memory.content.substring(0, 200),
          code: p.code || memory.content,
          language: p.language || 'typescript',
          usageCount: (memory.accessCount || 0) + 1,
          lastUsedAt: memory.lastAccessedAt
            ? new Date(memory.lastAccessedAt)
            : new Date(memory.updatedAt),
          relatedFiles: (memory.metadata?.fileContext?.path
            ? [memory.metadata.fileContext.path]
            : []) as string[],
        };
      }

      // Fallback: create pattern from memory directly
      return {
        id: memory.id,
        name: memory.metadata?.title || `Pattern ${memory.id.substring(0, 8)}`,
        description: memory.content.substring(0, 200),
        code: memory.content,
        language: (memory.metadata?.fileContext?.language as string) || 'typescript',
        usageCount: memory.accessCount || 1,
        lastUsedAt: memory.lastAccessedAt
          ? new Date(memory.lastAccessedAt)
          : new Date(memory.updatedAt),
        relatedFiles: (memory.metadata?.fileContext?.path
          ? [memory.metadata.fileContext.path]
          : []) as string[],
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a file violates a specific pattern
   */
  private checkPatternViolation(fileContent: string, pattern: CodePattern): Violation[] {
    const violations: Violation[] = [];

    // Pattern-based checks based on pattern name/type
    const checks = this.getPatternChecks(pattern);

    for (const check of checks) {
      const lines = fileContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (check.antiPattern.test(line)) {
          // Check if the correct pattern exists nearby
          const contextStart = Math.max(0, i - 3);
          const contextEnd = Math.min(lines.length, i + 4);
          const context = lines.slice(contextStart, contextEnd).join('\n');

          if (!check.correctPattern || !check.correctPattern.test(context)) {
            violations.push({
              patternId: pattern.id,
              patternName: pattern.name,
              severity: check.severity,
              message: check.message,
              line: i + 1,
              suggestion: check.suggestion || pattern.code.substring(0, 200),
            });
          }
        }
      }
    }

    return violations;
  }

  /**
   * Get pattern checks for a given pattern
   */
  private getPatternChecks(pattern: CodePattern): Array<{
    antiPattern: RegExp;
    correctPattern?: RegExp;
    severity: 'warning' | 'error';
    message: string;
    suggestion?: string;
  }> {
    const nameLower = pattern.name.toLowerCase();
    const descLower = pattern.description.toLowerCase();

    // Common pattern checks
    const checks: Array<{
      antiPattern: RegExp;
      correctPattern?: RegExp;
      severity: 'warning' | 'error';
      message: string;
      suggestion?: string;
    }> = [];

    // Error handling patterns
    if (nameLower.includes('error') || descLower.includes('error handling')) {
      checks.push({
        antiPattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
        severity: 'error',
        message: 'Empty catch block detected - errors are silently ignored',
        suggestion: 'Add error handling logic to catch block',
      });
      checks.push({
        antiPattern: /catch\s*\(\s*e\s*\)\s*\{[^}]*console\.log\(e\)/,
        severity: 'warning',
        message: 'Using console.log for error handling',
        suggestion: 'Use proper error logging or re-throw the error',
      });
    }

    // Async patterns
    if (nameLower.includes('async') || descLower.includes('async')) {
      checks.push({
        antiPattern: /async\s+function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/,
        severity: 'warning',
        message: 'Async function may need try-catch for error handling',
      });
    }

    // Import patterns
    if (nameLower.includes('import') || descLower.includes('import')) {
      checks.push({
        antiPattern: /require\s*\(\s*['"][^'"]+['"]\s*\)/,
        severity: 'warning',
        message: 'Using require() instead of ES modules import',
        suggestion: 'Consider using import statements for consistency',
      });
    }

    // TypeScript patterns
    if (pattern.language === 'typescript' || nameLower.includes('typescript')) {
      checks.push({
        antiPattern: /:\s*any\s*[,;=)]/,
        severity: 'warning',
        message: 'Using any type reduces type safety',
        suggestion: 'Use specific types or unknown with type guards',
      });
    }

    // Naming patterns
    if (nameLower.includes('naming') || descLower.includes('naming')) {
      checks.push({
        antiPattern: /const\s+[a-z][a-zA-Z0-9]*\s*=\s*\[.*\]/,
        severity: 'warning',
        message: 'Array constant should use UPPER_SNAKE_CASE',
      });
    }

    // Default: check for similar code that might violate
    if (checks.length === 0) {
      // Try to extract anti-patterns from pattern code
      const patternCode = pattern.code;

      // Check for common patterns in the code
      if (patternCode.includes('try') && patternCode.includes('catch')) {
        checks.push({
          antiPattern: /[^/]*\S+\s*\([^)]*\)\s*\{[^}]*\}(?!\s*catch)/,
          correctPattern: /try\s*\{/,
          severity: 'warning',
          message: 'Function without error handling - consider try-catch',
        });
      }
    }

    return checks;
  }

  /**
   * Calculate pattern confidence based on usage
   */
  calculateConfidence(pattern: CodePattern): number {
    const usageWeight = Math.min(pattern.usageCount / 10, 0.5);
    const recencyWeight = pattern.lastUsedAt
      ? Math.exp(-(Date.now() - pattern.lastUsedAt.getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    return Math.min(1.0, 0.4 + usageWeight + recencyWeight * 0.3);
  }

  /**
   * Rank patterns by relevance to current context
   */
  rankPatterns(
    patterns: CodePattern[],
    context: { language?: string; filePath?: string }
  ): CodePattern[] {
    return patterns
      .map((p) => ({
        pattern: p,
        score: this.calculateRelevanceScore(p, context),
      }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.pattern);
  }

  /**
   * Calculate relevance score for a pattern in context
   */
  private calculateRelevanceScore(
    pattern: CodePattern,
    context: { language?: string; filePath?: string }
  ): number {
    let score = 0;

    // Language match
    if (context.language && pattern.language === context.language) {
      score += 0.3;
    }

    // File path match (pattern used in similar files)
    if (context.filePath && pattern.relatedFiles.length > 0) {
      const pathMatches = pattern.relatedFiles.filter((f) =>
        this.pathsAreSimilar(f, context.filePath!)
      ).length;
      score += Math.min(0.3, pathMatches * 0.1);
    }

    // Usage count
    score += Math.min(0.2, pattern.usageCount * 0.02);

    // Recency
    if (pattern.lastUsedAt) {
      const daysSinceUse = (Date.now() - pattern.lastUsedAt.getTime()) / (24 * 60 * 60 * 1000);
      score += Math.max(0, 0.2 - daysSinceUse * 0.01);
    }

    return score;
  }

  /**
   * Check if two paths are similar (same directory or extension)
   */
  private pathsAreSimilar(path1: string, path2: string): boolean {
    const parts1 = path1.split('/');
    const parts2 = path2.split('/');

    // Same filename
    if (parts1[parts1.length - 1] === parts2[parts2.length - 1]) {
      return true;
    }

    // Same extension
    const ext1 = path1.split('.').pop();
    const ext2 = path2.split('.').pop();
    if (ext1 && ext1 === ext2) {
      return true;
    }

    // Same parent directory
    if (parts1.length > 1 && parts2.length > 1) {
      return parts1[parts1.length - 2] === parts2[parts2.length - 2];
    }

    return false;
  }
}

export default PatternExtractor;
