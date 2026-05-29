// Pure validators for numeric TextInput submits. Mirrors cli.ts:232,241
// but returns a discriminated union instead of calling process.exit
// (which would tear down the TUI).

export type ValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parsePositiveInteger(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Value is required." };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "Must be a positive integer." };
  }
  return { ok: true, value: n };
}

export function parsePositiveNumber(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Value is required." };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Must be a positive number." };
  }
  return { ok: true, value: n };
}
