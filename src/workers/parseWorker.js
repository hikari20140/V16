import { parentPort, workerData } from "node:worker_threads";
import { parse } from "../parser/simpleParser.js";

function run() {
  const startedAt = Date.now();
  const { source } = workerData;
  const { ast, tokens } = parse(source);

  parentPort.postMessage({
    ast,
    tokens,
    meta: {
      stage: "parse",
      tokenCount: tokens.length,
      elapsedMs: Date.now() - startedAt
    }
  });
}

run();
