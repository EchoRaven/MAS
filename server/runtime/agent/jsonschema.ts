// A compact JSON Schema check for port schemas and validate stages: type,
// required, properties, items, enum, const, minimum/maximum, min/maxLength.
type Schema = Record<string, unknown>;

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

export function validateJson(value: unknown, schema: Schema, at = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type as string | string[] | undefined;
  if (t) {
    const ok = (Array.isArray(t) ? t : [t]).some((x) => x === typeOf(value) || (x === "number" && typeOf(value) === "integer"));
    if (!ok) return [`${at}: expected ${Array.isArray(t) ? t.join("|") : t}, got ${typeOf(value)}`];
  }
  if (schema.enum && !(schema.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${at}: not one of ${JSON.stringify(schema.enum)}`);
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errs.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${at}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${at}: above ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errs.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errs.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in obj)) errs.push(`${at}.${k}: required`);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const [k, s] of Object.entries(props)) if (k in obj) errs.push(...validateJson(obj[k], s, `${at}.${k}`));
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validateJson(v, schema.items as Schema, `${at}[${i}]`)));
  return errs;
}

export function schemaById(doc: { schemas: { id: string; json_schema: string }[] }, id?: string | null): Schema | null {
  if (!id) return null;
  const s = doc.schemas.find((x) => x.id === id);
  if (!s) return null;
  try {
    return JSON.parse(s.json_schema);
  } catch {
    return null;
  }
}
