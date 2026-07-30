/**
 * Read string env vars that must work on Cloudflare Workers (OpenNext).
 *
 * Dashboard / wrangler vars are on the Worker `env` binding. OpenNext usually
 * mirrors them to process.env, but not always for newly added keys — always
 * check Cloudflare context as well.
 */
import 'server-only';

function stripEnvQuotes(value: string): string {
  const t = value.trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = stripEnvQuotes(value);
  return t ? t : undefined;
}

function readFromCloudflareContext(name: string): string | undefined {
  try {
    const ctx = Reflect.get(globalThis, Symbol.for('__cloudflare-context__')) as
      | { env?: Record<string, unknown> }
      | undefined;
    const fromAls = asNonEmptyString(ctx?.env?.[name]);
    if (fromAls) return fromAls;
  } catch {
    // outside request ALS
  }

  try {
    // eslint-disable-next-line no-new-func -- avoid bundling cloudflare:workers into every graph
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return undefined;
    try {
      const mod = req('@opennextjs/cloudflare') as {
        getCloudflareContext?: (opts?: { async?: boolean }) => { env?: Record<string, unknown> };
      };
      if (typeof mod.getCloudflareContext === 'function') {
        const v = asNonEmptyString(mod.getCloudflareContext({ async: false })?.env?.[name]);
        if (v) return v;
      }
    } catch {
      // package not in graph
    }
    try {
      const workers = req('cloudflare:workers') as { env?: Record<string, unknown> };
      const v = asNonEmptyString(workers?.env?.[name]);
      if (v) return v;
    } catch {
      // not workers
    }
  } catch {
    // ignore
  }

  return undefined;
}

/** Trimmed runtime string, or undefined when unset. */
export function readRuntimeEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = asNonEmptyString(process.env[name]);
    if (fromProcess) return fromProcess;
  }
  return readFromCloudflareContext(name);
}

/** First non-empty value among named keys (process.env + CF env). */
export function readRuntimeEnvAny(names: string[]): string | undefined {
  for (const name of names) {
    const v = readRuntimeEnv(name);
    if (v) return v;
  }
  return undefined;
}
