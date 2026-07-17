/** Client-side structured diagnostics — mirrors server logger JSON format. */

type LogLevel = 'info' | 'warn' | 'error';

const isDev = process.env.NODE_ENV === 'development';

function normalizeContext(context?: unknown): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  if (context instanceof Error) {
    return { error: context.message, stack: context.stack };
  }
  if (typeof context === 'object' && context !== null && !Array.isArray(context)) {
    return context as Record<string, unknown>;
  }
  return { detail: context };
}

/** Scan/OCR breadcrumbs stay visible in production so cold-start hangs are diagnosable. */
function isScanPipelineBreadcrumb(message: string): boolean {
  return /^(ocr\.|ro\.scan\.|xentry\.|image\.compression)/.test(message);
}

function write(level: LogLevel, message: string, context?: unknown): void {
  if (level === 'error') {
    // always
  } else if (isDev) {
    // always in development
  } else if (isScanPipelineBreadcrumb(message)) {
    // production: only scan/OCR stage logs (first-scan hang diagnosis)
  } else {
    return;
  }

  const normalized = normalizeContext(context);
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'merlinus-client',
    ...normalized,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'info') {
    console.info(line);
    return;
  }
  console.warn(line);
}

export const clientLog = {
  info: (message: string, context?: unknown) => write('info', message, context),
  warn: (message: string, context?: unknown) => write('warn', message, context),
  error: (message: string, context?: unknown) => write('error', message, context),
};