import type { NextConfig } from 'next';

// A api do RH fica atrás do mesmo domínio: o cookie httpOnly do Better Auth só vai na mesma origem.
// Sem segredo nem chave no front: o Next só repassa a requisição.
const apiUrl = process.env.API_URL ?? 'http://localhost:3002';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  async rewrites() {
    return [
      { source: '/portal/:path*', destination: `${apiUrl}/portal/:path*` },
      { source: '/auth/:path*', destination: `${apiUrl}/auth/:path*` },
      { source: '/me', destination: `${apiUrl}/me` },
    ];
  },
};

export default config;
