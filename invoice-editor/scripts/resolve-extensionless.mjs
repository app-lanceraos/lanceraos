// Phase 2b test infra — a tiny Node ESM loader hook that lets `node --test`
// resolve the editor's existing extensionless relative imports (e.g.
// `from '../utils/units'`), which Vite resolves natively but Node's own
// ESM resolver requires an explicit extension for. Rather than adding
// `.js` to every import statement across the whole editor codebase (a
// large, unrelated, out-of-scope change just to satisfy the test runner),
// this hook retries a failed bare-specifier resolution with `.js`
// appended — a narrow, test-only shim, never loaded by the real app
// (Vite never sees this file).
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !specifier.endsWith('.js') &&
      !specifier.endsWith('.json')
    ) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
