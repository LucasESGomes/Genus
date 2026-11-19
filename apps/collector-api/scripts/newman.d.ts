/** Tipos mínimos do Newman (o pacote não traz tipos). */
declare module 'newman' {
  interface NewmanRunOptions {
    collection: string;
    environment?: string;
    envVar?: { key: string; value: string }[];
    workingDir?: string;
    insecureFileRead?: boolean;
    reporters?: string[];
    reporter?: Record<string, Record<string, string>>;
  }
  interface NewmanSummary {
    run: { failures: unknown[] };
  }
  const newman: {
    run(options: NewmanRunOptions, callback: (err: Error | null, summary: NewmanSummary) => void): unknown;
  };
  export default newman;
}
