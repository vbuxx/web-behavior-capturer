export interface RedactionSummary {
  policyVersion: '1.0.0';
  replacement: '[REDACTED]';
  redactedValues: number;
  categories: string[];
}

const sensitiveKeys = new Map<string, string>([
  ['password', 'credential'],
  ['passwd', 'credential'],
  ['secret', 'credential'],
  ['token', 'token'],
  ['accesstoken', 'token'],
  ['refreshtoken', 'token'],
  ['authorization', 'authorization'],
  ['cookie', 'cookie'],
  ['setcookie', 'cookie'],
  ['apikey', 'credential'],
  ['session', 'session'],
  ['sessionid', 'session'],
  ['email', 'personal_data'],
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function categoryForKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const normalized = normalizeKey(key);
  const direct = sensitiveKeys.get(normalized);
  if (direct) return direct;
  for (const [candidate, category] of sensitiveKeys) {
    if (normalized.endsWith(candidate)) return category;
  }
  return undefined;
}

export class Redactor {
  readonly #categories = new Set<string>();
  #redactedValues = 0;

  #replace(category: string): '[REDACTED]' {
    this.#categories.add(category);
    this.#redactedValues += 1;
    return '[REDACTED]';
  }

  #redactUrl(value: string): string {
    let url: URL;
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    const relative = value.startsWith('/') || value.includes('?');
    if (!absolute && !relative) {
      return value.replace(/\bBearer\s+[^\s,;]+/gi, () => `Bearer ${this.#replace('authorization')}`);
    }
    try {
      url = new URL(value, 'https://wbc.invalid');
    } catch {
      return value.replace(/\bBearer\s+[^\s,;]+/gi, () => `Bearer ${this.#replace('authorization')}`);
    }
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      const category = categoryForKey(key);
      if (!category) continue;
      const values = url.searchParams.getAll(key);
      url.searchParams.delete(key);
      for (const currentValue of values) {
        url.searchParams.append(key, currentValue === '[REDACTED]' ? currentValue : this.#replace(category));
      }
      changed = true;
    }
    if (!changed) return value;
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  }

  redact<T>(value: T, key?: string): T {
    const category = categoryForKey(key);
    if (category && value !== null && value !== undefined) return this.#replace(category) as T;
    if (typeof value === 'string') return this.#redactUrl(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.redact(item)) as T;
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const namedCategory = typeof record.name === 'string' ? categoryForKey(record.name) : undefined;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      if (childKey === 'value' && namedCategory && childValue !== null && childValue !== undefined) {
        result[childKey] = this.#replace(namedCategory);
      } else {
        result[childKey] = this.redact(childValue, childKey);
      }
    }
    return result as T;
  }

  summary(): RedactionSummary {
    return {
      policyVersion: '1.0.0',
      replacement: '[REDACTED]',
      redactedValues: this.#redactedValues,
      categories: [...this.#categories].sort(),
    };
  }
}
