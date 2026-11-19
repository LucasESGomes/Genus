// Gera as imagens SINTÉTICAS (sem rosto) usadas pela coleção do Postman.
//   node postman/fixtures/generate.mjs
// synthetic.png e not-an-image.png são pequenas e versionadas; too-large.jpg
// (> 1 MB) é gerada sob demanda e fica fora do git.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG cinza em degradê, 64x64, válido e determinístico. */
function syntheticPng(size = 64) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profundidade
  header[9] = 0; // tons de cinza
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1); // byte de filtro 0 + pixels
    for (let x = 0; x < size; x++) row[x + 1] = Math.floor(((x + y) / (2 * size)) * 255);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(path.join(dir, 'synthetic.png'), syntheticPng());
writeFileSync(path.join(dir, 'not-an-image.png'), 'Isto não é uma imagem: texto com extensão .png.\n');
// 1,2 MB começando com a assinatura JPEG (FF D8 FF); o resto é lixo, só o tamanho importa.
const big = Buffer.alloc(1_258_291, 0x41);
big[0] = 0xff;
big[1] = 0xd8;
big[2] = 0xff;
writeFileSync(path.join(dir, 'too-large.jpg'), big);
process.stdout.write('Fixtures geradas em postman/fixtures/.\n');
