#!/usr/bin/env node
/**
 * pnpm postman:export
 *
 * Gera, a partir da coleção YAML (fonte da verdade, postman/collections/), UM
 * arquivo que o botão Import do Postman aceita direto, e o environment de dev:
 *
 *   postman/export/Genus Coletor.postman_collection.json
 *   postman/export/Genus Coletor - dev.postman_environment.json
 *
 * Os arquivos de imagem saem com caminho ABSOLUTO desta máquina (não precisa
 * configurar Working directory). Por isso postman/export/ fica fora do Git.
 * Opção: --files-root <pasta> para apontar as imagens para outro clone.
 * A chave de serviço NÃO entra no arquivo: preencha `serviceKey` no Postman.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const collectionsDir = path.join(root, 'postman', 'collections');
const outDir = path.join(root, 'postman', 'export');
// --files-root <pasta>: raiz usada nos caminhos absolutos das imagens (padrão: este repositório).
const argv = process.argv.slice(2).filter((a) => a !== '--');
const filesRootArg = argv.indexOf('--files-root');
const filesRoot = filesRootArg === -1 ? root : path.resolve(argv[filesRootArg + 1] ?? root);
const out = (line = '') => process.stdout.write(`${line}\n`);

const readYaml = (file) => YAML.parse(readFileSync(file, 'utf8'));
const kv = (v) => (Array.isArray(v) ? v : Object.entries(v ?? {}).map(([key, value]) => ({ key, value: String(value) })));

function auth(a) {
  if (!a) return undefined;
  const one = Array.isArray(a) ? a[0] : a;
  if (!one || one.type === 'inherit') return undefined;
  if (one.type === 'noauth') return { type: 'noauth' };
  return { type: one.type, [one.type]: kv(one.credentials).map((c) => ({ key: c.key, value: c.value, type: 'string' })) };
}

function events(scripts, scope) {
  return (scripts ?? []).map((s) => {
    const t = s.type.replace(/^http:/, '');
    return {
      listen: t === 'beforeRequest' ? 'prerequest' : 'test',
      script: { type: 'text/javascript', exec: String(s.code).split('\n') },
    };
  }).filter((e) => e && scope);
}

function body(b) {
  if (!b || b.type === 'none') return undefined;
  if (b.type === 'formdata') {
    return {
      mode: 'formdata',
      formdata: b.content.map((f) =>
        f.type === 'file'
          ? { key: f.key, type: 'file', src: path.resolve(filesRoot, f.src) }
          : { key: f.key, type: 'text', value: f.value },
      ),
    };
  }
  if (b.type === 'urlencoded') return { mode: 'urlencoded', urlencoded: kv(b.content) };
  return { mode: 'raw', raw: b.content, options: { raw: { language: b.type === 'json' ? 'json' : 'text' } } };
}

function examples(dir, req) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.example.yaml'))
    .map((f) => ({ f, e: readYaml(path.join(dir, f)) }))
    .sort((a, b) => (a.e.order ?? 0) - (b.e.order ?? 0))
    .map(({ f, e }) => ({
      name: e.name ?? f.replace(/\.example\.yaml$/, ''),
      originalRequest: { method: e.request?.method ?? req.method, header: [], url: e.request?.url ?? req.url },
      status: e.response.statusText ?? '',
      code: e.response.statusCode,
      header: kv(e.response.headers),
      body: e.response.body?.content ?? '',
    }));
}

function request(dir, file) {
  const r = readYaml(path.join(dir, file));
  const name = r.name ?? file.replace(/\.request\.yaml$/, '');
  const exDir = r.examples ? path.resolve(dir, r.examples) : undefined;
  const item = {
    name,
    event: events(r.scripts, true),
    request: {
      method: r.method,
      header: kv(r.headers),
      url: r.url,
      description: r.description,
      body: body(r.body),
      auth: auth(r.auth),
    },
    response: examples(exDir, r),
  };
  return { order: r.order ?? 0, item };
}

function folder(dir) {
  const defFile = path.join(dir, '.resources', 'definition.yaml');
  const def = existsSync(defFile) ? readYaml(defFile) : {};
  const children = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.resources') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) children.push(folder(full));
    else if (entry.endsWith('.request.yaml')) children.push(request(dir, entry));
  }
  children.sort((a, b) => a.order - b.order);
  return {
    order: def.order ?? 0,
    def,
    item: {
      name: def.name ?? path.basename(dir),
      description: def.description,
      item: children.map((c) => c.item),
      event: events(def.scripts, true),
      auth: auth(def.auth),
    },
  };
}

mkdirSync(outDir, { recursive: true });
const written = [];
for (const name of readdirSync(collectionsDir)) {
  const dir = path.join(collectionsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const { def, item } = folder(dir);
  const collection = {
    info: {
      _postman_id: randomUUID(),
      name: item.name,
      description: item.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: item.item,
    event: item.event,
    auth: item.auth,
    variable: kv(def.variables),
  };
  const file = path.join(outDir, `${name}.postman_collection.json`);
  writeFileSync(file, JSON.stringify(collection, null, 2));
  written.push(file);
}

const envSrc = path.join(root, 'postman', 'environments', 'dev.environment.yaml');
if (existsSync(envSrc)) {
  const env = readYaml(envSrc);
  const file = path.join(outDir, 'Genus Coletor - dev.postman_environment.json');
  writeFileSync(
    file,
    JSON.stringify(
      {
        id: randomUUID(),
        name: env.name,
        values: env.values.map((v) => ({ key: v.key, value: v.value, type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false })),
        _postman_variable_scope: 'environment',
      },
      null,
      2,
    ),
  );
  written.push(file);
}

out('Gerado (importe no Postman: Import > arraste os arquivos):');
for (const f of written) out(`  ${path.relative(root, f)}`);
out('Depois: escolha o environment "Genus Coletor · dev" e preencha serviceKey (COLLECTOR_SERVICE_KEYS do apps/collector-api/.env.dev).');
