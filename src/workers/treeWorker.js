import { parentPort, workerData } from "node:worker_threads";
import { buildExecutionTree } from "../parser/treeBuilder.js";

function run() {
  const startedAt = Date.now();
  const { source } = workerData;
  const tree = buildExecutionTree(source);

  parentPort.postMessage({
    tree,
    meta: {
      stage: "tree",
      elapsedMs: Date.now() - startedAt,
      ...tree.metrics
    }
  });
}

run();
