import { runVerifyChain } from './run-verify-chain.js';

// Casca fina: a lógica (e os testes) ficam em run-verify-chain.ts.
const code = await runVerifyChain({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
process.exitCode = code;
