// Stands in for Node's `util` in the browser bundle.
//
// @tensorflow-models/speech-commands has a top-level `import { promisify } from 'util'`, used
// in one branch that reads a model from a file:// URL via require('fs'). We load the model
// over HTTP, so that branch never runs — but the import still pulls in the npm `util`
// polyfill, and that package reads `process.env.NODE_DEBUG` unguarded while initialising:
//
//     if (process.env.NODE_DEBUG) {            // util/util.js:109
//
// In a browser there is no `process`, so loading the voice model threw "process is not
// defined" before it ever reached the network. vite.config.ts aliases `util` to this file so
// the import resolves to something real without dragging in the polyfill or a process shim.

type NodeCallback = (error: unknown, value?: unknown) => void;
type CallbackFn = (...args: never[]) => void;

/** Node's callback-to-promise helper, enough for the one call site that imports it. */
export function promisify(fn: CallbackFn) {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const done: NodeCallback = (error, value) => (error ? reject(error) : resolve(value));
      (fn as unknown as (...a: unknown[]) => void)(...args, done);
    });
}

export default { promisify };
