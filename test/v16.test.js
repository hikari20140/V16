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

test("V16 supports template literals with interpolation", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "let name = 'V16';",
    "let score = 40 + 2;",
    "let msg = `engine:${name}, score=${score}`;",
    "print(msg);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [["engine:V16, score=42"]]);
  assert.equal(result.runtime.env.msg, "engine:V16, score=42");
});

test("V16 supports arrow/anonymous functions with arguments", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "let add = (x, y) => x + y;",
    "let mul = function (a, b) { return a * b; };",
    "let mix = function (v) { return add(v, 2) + mul(v, 3); };",
    "print(mix(4));"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[18]]);
  assert.equal(result.runtime.env.add.__v16Type, "function");
});

test("V16 supports closures capturing outer scope", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "function makeCounter(base) {",
    "  let x = base;",
    "  return function(step) {",
    "    x = x + step;",
    "    return x;",
    "  };",
    "}",
    "let c = makeCounter(10);",
    "print(c(1));",
    "print(c(2));"
  ].join("\n");

  await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[11], [13]]);
});

test("V16 supports for/break/continue and &&/||", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "let sum = 0;",
    "for (let i = 0; i < 10; i = i + 1) {",
    "  if (i == 2) continue;",
    "  if (i == 6) break;",
    "  if ((i > 0 && i < 6) || i == 0) {",
    "    sum = sum + i;",
    "  }",
    "}",
    "print(sum);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[13]]);
  assert.equal(result.runtime.env.sum, 13);
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

test("V16 accepts external globals (input/document/v16doc) from CLI model", async () => {
  const logs = [];
  const engine = new V16Engine();
  const source = [
    "if (input.enabled && document.textIncludes('hello')) {",
    "  document.setHTML(document.getHTML() + ' world');",
    "}",
    "print(v16doc.textIncludes('world'));"
  ].join("\n");

  const result = await engine.execute(source, {
    globals: {
      input: { enabled: true },
      document: {
        html: "",
        getHTML() { return this.html || "hello"; },
        setHTML(value) { this.html = value; },
        textIncludes(text) { return this.getHTML().includes(text); }
      },
      v16doc: {
        textIncludes(text) {
          return text === "world";
        }
      }
    },
    logger: (...args) => logs.push(args)
  });

  assert.deepEqual(logs, [[true]]);
  assert.ok(result.stages.jit.optimizations);
});

test("V16 applies tree-guided LICM and block CSE stats", async () => {
  const engine = new V16Engine();
  const source = [
    "let a = 2 + 3;",
    "let b = 2 + 3;",
    "let i = 0;",
    "while (i < (a + b)) {",
    "  i = i + 1;",
    "}",
    "print(i);"
  ].join("\n");

  const result = await engine.execute(source, {
    logger: () => {}
  });

  assert.equal(result.stages.jit.optimizations.blockCseReuses > 0, true);
  assert.equal(result.stages.jit.optimizations.licmHoists > 0, true);
});
