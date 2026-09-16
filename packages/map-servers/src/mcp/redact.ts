/** Remove known credentials and common secret fields before evidence reaches the AI. */
export function redactMcpResult<T>(value: T, credential: Record<string, unknown>): T {
  const secrets: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string" && v.length >= 4) secrets.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(credential);
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") {
      let text = v;
      for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
      return text.replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
    }
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => [
          k,
          /^(authorization|password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token)$/i.test(
            k,
          )
            ? "[REDACTED]"
            : clean(item),
        ]),
      );
    return v;
  };
  return clean(value) as T;
}
