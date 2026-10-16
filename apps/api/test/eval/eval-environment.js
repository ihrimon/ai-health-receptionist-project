/**
 * Jest runs tests in a separate V8 context, so a Float32Array made inside
 * a test is not the Float32Array the ONNX runtime (the embedding model)
 * checks for: "A float32 tensor's data must be type of function
 * Float32Array()". Handing the tests the outer realm's typed arrays fixes
 * that. Only the eval needs it, so it lives next to the eval.
 */
const path = require('path');

// pnpm keeps jest's own packages out of reach, so find the environment by
// walking down from jest itself: jest -> jest-cli -> jest-config.
const from = (name, parent) =>
  require.resolve(name, { paths: [path.dirname(parent)] });
const jestCli = from('jest-cli', require.resolve('jest'));
const jestConfig = from('jest-config', jestCli);
const { TestEnvironment } = require(from('jest-environment-node', jestConfig));

class EvalEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of [
      'ArrayBuffer',
      'Uint8Array',
      'Int8Array',
      'Uint16Array',
      'Int16Array',
      'Uint32Array',
      'Int32Array',
      'Float32Array',
      'Float64Array',
      'BigInt64Array',
      'BigUint64Array',
    ]) {
      this.global[name] = globalThis[name];
    }
  }
}

module.exports = EvalEnvironment;
