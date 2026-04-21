/**
 * Structured logger — v0.10 Observability.
 *
 * Emits one JSON object per line to stderr. Stdout is reserved for the
 * MCP protocol; all diagnostic output MUST go to stderr.
 *
 * Level is controlled by the CONTEXT_FABRIC_LOG_LEVEL env var (one of
 * 'debug' | 'info' | 'warn' | 'error'), default 'info'. In test runs
 * (`NODE_ENV=test` or `VITEST=true`) the default drops to 'warn' to keep
 * output clean.
 *
 * Shape: { ts, level, module, msg, ...fields }
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function defaultLevel(): LogLevel {
  const env = (process.env.CONTEXT_FABRIC_LOG_LEVEL || '').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return 'warn';
  }
  return 'info';
}

let currentLevel: LogLevel = defaultLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function emit(level: LogLevel, module: string, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'ts' || k === 'level' || k === 'module' || k === 'msg') continue;
      record[k] = v;
    }
  }
  try {
    process.stderr.write(JSON.stringify(record) + '\n');
  } catch {
    // Fallback: never throw from a logger.
    process.stderr.write(`[${level}] ${module}: ${msg}\n`);
  }
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(module: string): Logger;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, fields) => emit('debug', module, msg, fields),
    info: (msg, fields) => emit('info', module, msg, fields),
    warn: (msg, fields) => emit('warn', module, msg, fields),
    error: (msg, fields) => emit('error', module, msg, fields),
    child: (sub: string) => createLogger(`${module}:${sub}`),
  };
}

/** Default root logger. Prefer createLogger('my-module') in library code. */
export const log: Logger = createLogger('context-fabric');
