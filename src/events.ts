/**
 * Event handlers
 * Automatically store memories based on CLI events
 */

import { CLIEvent, MemoryType, CLIEventType, Memory } from './types.js';
import { ContextEngine } from './engine.js';
import { detectLanguage } from './indexer/scanner.js';

export interface EventResult {
  processed: boolean;
  memoryId?: string;
  triggeredActions: string[];
  message?: string;
}

/**
 * EventHandler processes CLI events and creates memories automatically
 */
export class EventHandler {
  private engine: ContextEngine;

  constructor(engine: ContextEngine) {
    this.engine = engine;
  }

  /**
   * Handle a generic CLI event
   */
  async handleEvent(event: CLIEvent): Promise<EventResult> {
    switch (event.type) {
      case 'file_opened':
        return this.handleFileOpened(
          (event.payload.path ?? event.payload.filePath) as string,
          event.payload.content as string | undefined,
          event
        );

      case 'command_executed':
        return this.handleCommandExecuted(
          event.payload.command as string,
          event.payload.output as string | undefined,
          event
        );

      case 'error_occurred':
        return this.handleErrorOccurred(
          event.payload.error as string,
          event.payload.context as string | undefined,
          event
        );

      case 'decision_made':
        return this.handleDecisionMade(
          event.payload.decision as string,
          event.payload.rationale as string | undefined,
          event
        );

      case 'session_start':
        return this.handleSessionStart(
          (event.payload.projectPath ?? event.payload.project ?? event.payload.cwd ?? event.projectPath) as string,
          (event.payload.cliType ?? event.payload.cli ?? event.cliType) as string,
          event
        );

      case 'session_end':
        return this.handleSessionEnd(event);

      case 'pattern_detected':
        return this.handlePatternDetected(
          event.payload.pattern as string,
          event.payload.code as string | undefined,
          event
        );

      case 'user_feedback':
        return this.handleUserFeedback(
          event.payload.feedback as string,
          event.payload.rating as number | undefined,
          event
        );

      default:
        return {
          processed: false,
          triggeredActions: [],
          message: `Unknown event type: ${(event as CLIEvent).type}`,
        };
    }
  }

  /**
   * Handle file opened event
   * Creates a scratchpad entry in L1
   */
  async handleFileOpened(
    path: string,
    content?: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    const metadata: Record<string, unknown> = {
      fileContext: { path },
      source: 'system_auto',
      cliType: event?.cliType || 'generic',
      sessionId: event?.sessionId,
    };

    if (content) {
      metadata.codeBlock = {
        code: content.substring(0, 1000), // First 1000 chars
        language: this.detectLanguage(path),
        filePath: path,
      };
    }

    const memory = await this.engine.store(
      `File opened: ${path}`,
      'scratchpad',
      {
        layer: 1, // L1 - temporary
        metadata,
        tags: ['file_opened', 'auto_capture'],
        ttl: 3600, // 1 hour
      }
    );

    // Fire-and-forget code index update for this file
    try {
      const idx = this.engine.getCodeIndex();
      idx.reindexFile(path).catch(() => {/* non-critical */});
    } catch {
      /* non-critical */
    }

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['stored_scratchpad'],
    };
  }

  /**
   * Handle command executed event
   * Stores command in L1, extracts patterns/errors for L2/L3
   */
  async handleCommandExecuted(
    command: string,
    output?: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    const triggeredActions: string[] = [];

    // Store in L1 as scratchpad
    const memory = await this.engine.store(
      `Command: ${command}${output ? `\nOutput: ${output.substring(0, 500)}` : ''}`,
      'scratchpad',
      {
        layer: 1,
        metadata: {
          command,
          hasOutput: !!output,
          source: 'system_auto',
          cliType: event?.cliType || 'generic',
          sessionId: event?.sessionId,
        },
        tags: ['command_executed', 'auto_capture'],
        ttl: 7200, // 2 hours
      }
    );

    triggeredActions.push('stored_command');

    // If command failed (non-zero exit usually), store as error
    if (output && this.looksLikeError(output)) {
      await this.engine.store(
        `Error from command "${command}":\n${output}`,
        'bug_fix',
        {
          layer: 2, // L2 - project memory
          metadata: {
            command,
            errorOutput: output.substring(0, 2000),
            source: 'system_auto',
            cliType: event?.cliType || 'generic',
          },
          tags: ['error', 'command_failed', 'auto_capture'],
        }
      );
      triggeredActions.push('stored_error');
    }

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions,
    };
  }

  /**
   * Handle error occurred event
   * Stores error details for future reference
   */
  async handleErrorOccurred(
    error: string,
    context?: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    const content = context
      ? `Error: ${error}\nContext: ${context}`
      : `Error: ${error}`;

    const memory = await this.engine.store(
      content,
      'bug_fix',
      {
        layer: 2, // L2 - project-specific
        metadata: {
          error,
          context,
          source: 'system_auto',
          cliType: event?.cliType || 'generic',
          sessionId: event?.sessionId,
        },
        tags: ['error', 'bug_fix', 'auto_capture'],
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['stored_bug_fix'],
    };
  }

  /**
   * Handle decision made event
   * Stores architectural decisions
   */
  async handleDecisionMade(
    decision: string,
    rationale?: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    const content = rationale
      ? `Decision: ${decision}\nRationale: ${rationale}`
      : `Decision: ${decision}`;

    const memory = await this.engine.store(
      content,
      'decision',
      {
        layer: 2, // L2 - project-specific
        metadata: {
          decision,
          rationale,
          source: 'ai_inferred',
          cliType: event?.cliType || 'generic',
          sessionId: event?.sessionId,
        },
        tags: ['decision', 'architecture', 'auto_capture'],
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['stored_decision'],
    };
  }

  /**
   * Handle session start event
   * Initializes session context and returns ghost suggestions
   */
  async handleSessionStart(
    projectPath: string,
    cliType: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    // Store session start in L1
    const memory = await this.engine.store(
      `Session started: ${cliType} in ${projectPath}`,
      'scratchpad',
      {
        layer: 1,
        metadata: {
          projectPath,
          cliType,
          source: 'system_auto',
          cliType_actual: event?.cliType || cliType,
          sessionId: event?.sessionId,
        },
        tags: ['session_start', 'auto_capture'],
        ttl: 86400, // 24 hours
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['initialized_session', 'ghost_ready'],
    };
  }

  /**
   * Handle session end event
   * Summarizes session and archives
   */
  async handleSessionEnd(event?: CLIEvent): Promise<EventResult> {
    // Store session end marker
    const memory = await this.engine.store(
      'Session ended',
      'scratchpad',
      {
        layer: 1,
        metadata: {
          sessionId: event?.sessionId,
          source: 'system_auto',
          cliType: event?.cliType || 'generic',
        },
        tags: ['session_end', 'auto_capture'],
        ttl: 3600,
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['session_closed'],
    };
  }

  /**
   * Handle pattern detected event
   * Stores reusable patterns to L3
   */
  async handlePatternDetected(
    pattern: string,
    code?: string,
    event?: CLIEvent
  ): Promise<EventResult> {
    const content = code
      ? `Pattern: ${pattern}\n\nCode:\n${code}`
      : `Pattern: ${pattern}`;

    const memory = await this.engine.store(
      content,
      'code_pattern',
      {
        layer: 3, // L3 - global patterns
        metadata: {
          pattern,
          code,
          source: 'ai_inferred',
          cliType: event?.cliType || 'generic',
          sessionId: event?.sessionId,
        },
        tags: ['pattern', 'code_pattern', 'auto_capture'],
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['stored_pattern'],
    };
  }

  /**
   * Handle user feedback event
   * Stores preferences to L3
   */
  async handleUserFeedback(
    feedback: string,
    rating?: number,
    event?: CLIEvent
  ): Promise<EventResult> {
    const content = rating !== undefined
      ? `Feedback (rating: ${rating}/5): ${feedback}`
      : `Feedback: ${feedback}`;

    const memory = await this.engine.store(
      content,
      'relationship',
      {
        layer: 3, // L3 - long-term preferences
        metadata: {
          feedback,
          rating,
          source: 'user_explicit',
          cliType: event?.cliType || 'generic',
          sessionId: event?.sessionId,
        },
        tags: ['feedback', 'user_preference', 'auto_capture'],
      }
    );

    return {
      processed: true,
      memoryId: memory.id,
      triggeredActions: ['stored_feedback'],
    };
  }

  /**
   * Detect programming language from file path.
   * Delegates to the shared utility in indexer/scanner.
   */
  private detectLanguage(path: string): string {
    return detectLanguage(path);
  }

  /**
   * Check if output looks like an error
   */
  private looksLikeError(output: string): boolean {
    const errorIndicators = [
      /error/i,
      /exception/i,
      /failed/i,
      /fatal/i,
      /panic/i,
      /traceback/i,
      /command not found/i,
      /exit code [1-9]/i,
      /non-zero exit/i,
      /ENOENT/i,
      /EACCES/i,
      /syntax error/i,
      /compilation failed/i,
    ];

    return errorIndicators.some((pattern) => pattern.test(output));
  }
}

export default EventHandler;
