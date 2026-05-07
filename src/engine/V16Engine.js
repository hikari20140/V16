import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { compileToBinary } from "../jit/JitCompiler.js";
import { BytecodeVM, runBinaryStream } from "../runtime/StreamRunner.js";

const PARSE_WORKER = new URL("../workers/parseWorker.js", import.meta.url);
const TREE_WORKER = new URL("../workers/treeWorker.js", import.meta.url);

export class V16Engine {
  async execute(source, options = {}) {
    const {
      chunkSize = 96,
      logger = console.log,
      modules = {},
      moduleName = "main",
      globals = {}
    } = options;

    const pipelineStarted = Date.now();

    const [parseResult, treeResult] = await Promise.all([
      runWorker(PARSE_WORKER, { source }),
      runWorker(TREE_WORKER, { source })
    ]);

    const jitStarted = Date.now();
    const jitResult = compileToBinary(parseResult.ast, treeResult.tree);
    const jitElapsedMs = Date.now() - jitStarted;

    const runStarted = Date.now();
    const stream = bufferToStream(jitResult.binary, chunkSize);
    const vm = new BytecodeVM({ logger, modules, moduleName, globals });
    const runtime = await runBinaryStream(stream, vm);
    const runElapsedMs = Date.now() - runStarted;

    return {
      runtime,
      stages: {
        parse: parseResult.meta,
        tree: treeResult.meta,
        jit: { ...jitResult.meta, elapsedMs: jitElapsedMs },
        run: { elapsedMs: runElapsedMs },
        totalElapsedMs: Date.now() - pipelineStarted
      },
      artifacts: {
        tokens: parseResult.tokens,
        ast: parseResult.ast,
        tree: treeResult.tree,
        instructions: jitResult.instructions
      }
    };
  }
}

function runWorker(workerUrl, workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}.`));
      }
    });
  });
}

function bufferToStream(buffer, chunkSize) {
  async function* chunkGenerator() {
    for (let i = 0; i < buffer.length; i += chunkSize) {
      yield buffer.subarray(i, Math.min(i + chunkSize, buffer.length));
    }
  }
  return Readable.from(chunkGenerator());
}
