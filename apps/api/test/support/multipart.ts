/** Corpo multipart/form-data montado à mão para `app.inject`. */
export function multipart(
  fields: Record<string, string>,
  files: { field: string; filename: string; mime: string; data: Buffer }[],
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----genus${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** PDF mínimo fictício (só o cabeçalho conta para a checagem de tipo). */
export const fakePdf = (tag: string) => Buffer.from(`%PDF-1.4\n% atestado ficticio ${tag}\n%%EOF\n`);
