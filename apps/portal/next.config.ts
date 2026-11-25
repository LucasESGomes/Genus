import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// A api do RH fica atrás do mesmo domínio: o cookie httpOnly do Better Auth só vai na mesma origem.
// Sem segredo nem chave no front: o Next só repassa a requisição.
const apiUrl = process.env.API_URL ?? 'http://localhost:3002';
// O totem web (/totem) registra ponto na api do coletor, também na mesma origem (sem CORS, sem segredo no navegador).
const collectorUrl = process.env.COLLECTOR_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  // Standalone é para a imagem Docker (Linux). No Windows sem modo desenvolvedor, copiar os links
  // do pnpm para .next/standalone falha com EPERM; lá o build fica no modo normal.
  // NEXT_STANDALONE=1 força o standalone em qualquer sistema.
  output: process.platform !== 'win32' || process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // fileURLToPath decodifica acento e espaço do caminho (Ot%C3%A1vio%20…). `URL.pathname` não decodifica,
  // e a saída standalone ia parar numa pasta errada (apps/Otávio Vinícius/…).
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  async rewrites() {
    return [
      // /me é página (área do colaborador) e páginas vencem os rewrites: a api é chamada por /auth/whoami.
      { source: '/auth/whoami', destination: `${apiUrl}/me` },
      { source: '/portal/:path*', destination: `${apiUrl}/portal/:path*` },
      { source: '/auth/:path*', destination: `${apiUrl}/auth/:path*` },
      { source: '/coletor/:path*', destination: `${collectorUrl}/coletor/:path*` },
    ];
  },
};

export default config;
