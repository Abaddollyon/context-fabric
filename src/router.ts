/**
 * SmartRouter - Auto-route memories to appropriate layer
 * Analyzes content and metadata to determine optimal storage layer
 */

import { MemoryType, MemoryLayer } from './types.js';

export interface RoutingCriteria {
  content: string;
  type: MemoryType;
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number;
  forceLayer?: MemoryLayer;
}

export interface RoutingDecision {
  layer: MemoryLayer;
  reason: string;
  confidence: number;
}

/**
 * SmartRouter analyzes content and decides which layer to store memories
 */
export class SmartRouter {
  /**
   * Analyze content and decide which layer
   * Rules:
   * - scratchpad → L1 (temporary)
   * - code_pattern, convention → L3 (global knowledge)
   * - decision, bug_fix → L2 (project-specific)
   * - relationship → L3 (user prefs)
   * - If tags include 'temp' → L1
   * - If tags include 'global' → L3
   * - If forceLayer is specified → use that
   */
  static route(
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>,
    tags?: string[],
    ttl?: number,
    forceLayer?: MemoryLayer
  ): RoutingDecision {
    // Priority 1: Forced layer takes precedence
    if (forceLayer !== undefined) {
      return {
        layer: forceLayer,
        reason: 'Layer explicitly specified',
        confidence: 1.0,
      };
    }

    // Priority 2: Check tags for routing hints
    const normalizedTags = tags?.map((t) => t.toLowerCase()) || [];

    if (normalizedTags.includes('temp') || normalizedTags.includes('temporary')) {
      return {
        layer: MemoryLayer.L1_WORKING,
        reason: "Tagged as 'temp' - routing to working memory",
        confidence: 0.95,
      };
    }

    if (normalizedTags.includes('global') || normalizedTags.includes('universal')) {
      return {
        layer: MemoryLayer.L3_SEMANTIC,
        reason: "Tagged as 'global' - routing to semantic memory",
        confidence: 0.95,
      };
    }

    if (normalizedTags.includes('project') || normalizedTags.includes('local')) {
      return {
        layer: MemoryLayer.L2_PROJECT,
        reason: "Tagged as 'project' - routing to project memory",
        confidence: 0.95,
      };
    }

    // Priority 3: TTL indicates temporary content → L1
    if (ttl !== undefined && ttl > 0) {
      return {
        layer: MemoryLayer.L1_WORKING,
        reason: 'TTL specified - routing to working memory for temporary storage',
        confidence: 0.9,
      };
    }

    // Priority 4: Content type-based routing
    switch (type) {
      case 'scratchpad':
        return {
          layer: MemoryLayer.L1_WORKING,
          reason: 'Scratchpad content - temporary by nature',
          confidence: 0.95,
        };

      case 'code_pattern':
      case 'convention':
        return {
          layer: MemoryLayer.L3_SEMANTIC,
          reason: 'Code patterns and conventions are globally reusable knowledge',
          confidence: 0.9,
        };

      case 'decision':
      case 'bug_fix':
        return {
          layer: MemoryLayer.L2_PROJECT,
          reason: 'Decisions and bug fixes are project-specific context',
          confidence: 0.85,
        };

      case 'relationship':
        return {
          layer: MemoryLayer.L3_SEMANTIC,
          reason: 'Relationships represent user preferences - long-term knowledge',
          confidence: 0.85,
        };

      case 'code':
        // Code snippets might be patterns (L3) or session-specific (L1)
        return SmartRouter.routeCodeContent(content, metadata);

      case 'message':
      case 'thought':
      case 'observation':
        return {
          layer: MemoryLayer.L1_WORKING,
          reason: 'Transient content - working memory appropriate',
          confidence: 0.8,
        };

      case 'documentation':
        return {
          layer: MemoryLayer.L2_PROJECT,
          reason: 'Documentation typically project-specific',
          confidence: 0.75,
        };

      case 'error':
        return {
          layer: MemoryLayer.L2_PROJECT,
          reason: 'Errors usually project-specific for debugging',
          confidence: 0.75,
        };

      case 'summary':
        return {
          layer: MemoryLayer.L2_PROJECT,
          reason: 'Summaries archive project context',
          confidence: 0.8,
        };

      default:
        return {
          layer: MemoryLayer.L2_PROJECT,
          reason: 'Default routing to project memory for safety',
          confidence: 0.6,
        };
    }
  }

  /**
   * Route code content based on analysis
   */
  private static routeCodeContent(
    content: string,
    metadata?: Record<string, unknown>
  ): RoutingDecision {
    // Check if looks like a reusable pattern
    const isPattern = SmartRouter.looksLikePattern(content);
    const isGeneric = SmartRouter.looksGeneric(content);

    if (isPattern && isGeneric) {
      return {
        layer: MemoryLayer.L3_SEMANTIC,
        reason: 'Code appears to be a reusable pattern',
        confidence: 0.85,
      };
    }

    // Check if session-specific
    if (metadata?.sessionContext) {
      return {
        layer: MemoryLayer.L1_WORKING,
        reason: 'Code associated with current session',
        confidence: 0.75,
      };
    }

    // Default to project memory
    return {
      layer: MemoryLayer.L2_PROJECT,
      reason: 'Project-specific code snippet',
      confidence: 0.7,
    };
  }

  /**
   * Check if content looks like a reusable pattern
   */
  private static looksLikePattern(content: string): boolean {
    const patternIndicators = [
      /function\s+\w+\s*\([^)]*\)\s*\{/,
      /class\s+\w+/,
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /export\s+(const|let|var|function|class)/,
      /@\w+\s*\(/, // decorators
      /TODO|FIXME|NOTE|HACK/,
      /\/\*\*[\s\S]*?\*\//, // JSDoc comments
    ];

    return patternIndicators.some((pattern) => pattern.test(content));
  }

  /**
   * Check if code looks generic (not tied to specific business logic)
   */
  private static looksGeneric(content: string): boolean {
    const specificIndicators = [
      /company|business|client|customer|order|invoice/i,
      /userId|companyId|tenantId/i,
      /API_KEY|SECRET|PASSWORD/i,
    ];

    const genericIndicators = [
      /helper|util|utility/i,
      /format|parse|validate|transform/i,
      /generic|abstract/i,
    ];

    const specificCount = specificIndicators.filter((p) => p.test(content)).length;
    const genericCount = genericIndicators.filter((p) => p.test(content)).length;

    return genericCount >= specificCount;
  }

  /**
   * Get routing explanation for debugging
   */
  static explainRouting(decision: RoutingDecision): string {
    const layerNames: Record<MemoryLayer, string> = {
      [MemoryLayer.L1_WORKING]: 'L1 Working Memory',
      [MemoryLayer.L2_PROJECT]: 'L2 Project Memory',
      [MemoryLayer.L3_SEMANTIC]: 'L3 Semantic Memory',
    };

    return `[${layerNames[decision.layer]}] Confidence: ${(decision.confidence * 100).toFixed(0)}% - ${decision.reason}`;
  }
}

export default SmartRouter;
