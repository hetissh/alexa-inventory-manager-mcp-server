const STDOUT_METHODS = ['log', 'info', 'debug'] as const;

/**
 * Redirects console.log/info/debug to stderr so a stray log call (ours or a dependency's)
 * cannot corrupt the MCP JSON-RPC stream on stdout. Returns a function that restores the originals.
 * It does not intercept direct `process.stdout.write` calls.
 */
export function installStdoutGuard(target: Console): () => void {
  const originals = STDOUT_METHODS.map((method) => [method, target[method].bind(target)] as const);
  for (const method of STDOUT_METHODS) {
    target[method] = (...args: unknown[]): void => {
      target.error(...args);
    };
  }
  return () => {
    for (const [method, original] of originals) {
      target[method] = original;
    }
  };
}
