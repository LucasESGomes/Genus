/**
 * Compatibilidade cruzada TS <-> classes REAIS da engine (DEKManager, EmbeddingCrypto).
 * Interpretador: Python local (py -3 / python3 / python) com numpy+cryptography;
 * senão a imagem Docker `genus-face-engine`; senão o teste é pulado.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decryptDek,
  decryptEmbedding,
  encryptDek,
  encryptEmbedding,
  generateDek,
  l2Normalize,
} from '../src/crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptDir = path.join(here, 'python');
const engineDir = path.resolve(here, '../../../services/face-engine');

interface Runner {
  label: string;
  run: (input: string) => string;
}

function exec(cmd: string, args: string[], input: string, env?: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(cmd, args, { input, encoding: 'utf8', cwd, env, timeout: 120_000 });
}

function findRunner(): Runner | null {
  const candidates: Array<[string, string[]]> = [
    ['py', ['-3']],
    ['python3', []],
    ['python', []],
  ];
  for (const [cmd, pre] of candidates) {
    const probe = spawnSync(cmd, [...pre, '-c', 'import numpy, cryptography'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return {
        label: `${cmd} local`,
        run: (input) => {
          const r = exec(
            cmd,
            [...pre, path.join(scriptDir, 'check_crypto.py')],
            input,
            { ...process.env, PYTHONPATH: engineDir },
            engineDir,
          );
          if (r.status !== 0) throw new Error(`python falhou: ${r.stderr}`);
          return r.stdout;
        },
      };
    }
  }
  const docker = spawnSync('docker', ['image', 'inspect', 'genus-face-engine'], { encoding: 'utf8' });
  if (docker.status === 0) {
    return {
      label: 'docker genus-face-engine',
      run: (input) => {
        const r = exec(
          'docker',
          [
            'run', '--rm', '-i',
            '-v', `${engineDir}:/src:ro`,
            '-v', `${scriptDir}:/check:ro`,
            '-w', '/src',
            'genus-face-engine', 'python', '/check/check_crypto.py',
          ],
          input,
        );
        if (r.status !== 0) throw new Error(`docker falhou: ${r.stderr}`);
        return r.stdout;
      },
    };
  }
  return null;
}

const runner = findRunner();
const MASTER = randomBytes(32).toString('hex');

describe.skipIf(!runner)(
  `compatibilidade com a engine (${runner?.label ?? 'NÃO verificado: sem Python nem imagem Docker'})`,
  () => {
    it('TS cifra, a engine decifra', () => {
      const dek = generateDek();
      const raw = new Float32Array(512);
      for (let i = 0; i < 512; i++) raw[i] = Math.random() - 0.5;
      const v = l2Normalize(raw);
      const out = JSON.parse(
        runner!.run(
          JSON.stringify({
            mode: 'decrypt',
            masterKeyHex: MASTER,
            dek: encryptDek(dek, MASTER),
            embedding: encryptEmbedding(v, dek),
          }),
        ),
      ) as { dekHex: string; vector: number[] };
      expect(out.dekHex).toBe(dek.toString('hex'));
      expect(out.vector).toEqual(Array.from(v));
    });

    it('a engine cifra, TS decifra', () => {
      const out = JSON.parse(
        runner!.run(JSON.stringify({ mode: 'encrypt', masterKeyHex: MASTER })),
      ) as {
        dek: Parameters<typeof decryptDek>[0];
        dekHex: string;
        embedding: Parameters<typeof decryptEmbedding>[0];
        vector: number[];
      };
      const dek = decryptDek(out.dek, MASTER);
      expect(dek.toString('hex')).toBe(out.dekHex);
      expect(Array.from(decryptEmbedding(out.embedding, dek))).toEqual(out.vector);
    });
  },
);
