const sensitive = /password|passwd|secret|token|authorization|cookie|api[-_]?key|email|phone/i;
export function redact(value, seen = new WeakSet(), depth = 0) {
  if (depth > 20) return '[MAX_DEPTH]';
  if (typeof value === 'string') return value.replace(/\b(Bearer\s+)\S+/gi, '$1[REDACTED]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]').replace(/\b(?:\+?\d[\d -]{8,}\d)\b/g, '[PHONE]');
  if (!value || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (seen.has(value)) return '[CIRCULAR]'; seen.add(value);
  if (Array.isArray(value)) return value.map(v => redact(v, seen, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, seen, depth + 1) };
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(v, seen, depth + 1)]));
}
export function createLogger({ sink = event => console.log(JSON.stringify(event)), context = {}, sampleRate = 1, random = Math.random } = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) throw new Error('sampleRate must be between 0 and 1');
  return { emit(name, data = {}, level = 'info') {
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) throw new Error('Invalid event name');
    if (!['debug','info','warn','error'].includes(level)) throw new Error('Invalid event level');
    if (random() >= sampleRate && level !== 'error') return false;
    sink(redact({ timestamp: new Date().toISOString(), name, level, context, data })); return true;
  } };
}
