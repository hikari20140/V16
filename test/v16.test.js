import test from "node:test";
import assert from "node:assert/strict";
import { V16Engine } from "../src/engine/V16Engine.js";

test("V16 runs parse/tree/jit/run pipeline and executes bytecode stream", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "let a = 1 + 2 * 3;",
    "console.log(a);",
    "a = a + 4;",
    "print(a);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.equal(result.artifacts.ast.type, "Program");
  assert.ok(result.stages.parse.tokenCount > 0);
  assert.ok(result.stages.jit.instructionCount > 0);
  assert.deepEqual(logs, [[7], [11]]);
  assert.equal(result.runtime.env.a, 11);
});
