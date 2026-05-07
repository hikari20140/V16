import test from "node:test";
import assert from "node:assert/strict";
import { V16Engine } from "../src/engine/V16Engine.js";

test("V16 executes arithmetic, assignment, and print pipeline", async () => {
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

test("V16 executes function + while grammar subset", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "function sumTo(n) {",
    "  let acc = 0;",
    "  while (n > 0) {",
    "    acc = acc + n;",
    "    n = n - 1;",
    "  }",
    "  return acc;",
    "}",
    "let total = sumTo(4);",
    "print(total);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[10]]);
  assert.equal(result.runtime.env.total, 10);
});

test("V16 supports import/export subset with module map", async () => {
  const engine = new V16Engine();
  const source = [
    "import { pi } from 'math';",
    "export const area = pi * 2 * 2;",
    "export { area as circleArea };",
    "export default area;"
  ].join("\n");

  const result = await engine.execute(source, {
    modules: {
      math: { pi: 3 }
    },
    logger: () => {}
  });

  assert.equal(result.runtime.env.area, 12);
  assert.equal(result.runtime.exports.area, 12);
  assert.equal(result.runtime.exports.circleArea, 12);
  assert.equal(result.runtime.exports.default, 12);
});

test("V16 applies constant folding and dead-statement optimizations", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "1 + 2;",
    "if (false) { print(1); } else { 4 + 5; }",
    "while (false) { print(2); }",
    "let x = 2 * 3;",
    "print(x);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[6]]);
  assert.equal(result.stages.jit.optimizations.foldedConstants > 0, true);
  assert.equal(result.stages.jit.optimizations.removedPureExpressions > 0, true);
  assert.equal(result.stages.jit.optimizations.prunedBranches > 0, true);
  assert.equal(result.stages.jit.optimizations.removedLoops > 0, true);
});
