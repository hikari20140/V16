# V16

V16 is a JavaScript execution engine prototype with a four-stage pipeline:

1. Parse
2. Tree
3. JIT Compile
4. Run

## Architecture

- `Parse` and `Tree` run in parallel worker threads.
- `JIT Compile` transforms AST into V16 bytecode.
- `Run` executes bytecode from a stream-powered VM.

## Grammar Subset

- Declarations: `var`, `let`, `const`
- Control flow: `if / else`, `while`
- Functions: `function` declaration + `return`
- Module syntax: `import`, `export`, `export default`
- Expressions:
  - literals: number/string/boolean/null
  - arithmetic: `+ - * /`
  - comparisons: `< > <= >= == !=`
  - unary: `- !`
  - assignment and calls (`print`, `console.log`, user functions)

## JIT Optimizations

- Constant folding (`2 * 3` -> `6`)
- Pure expression elimination
- Dead branch pruning (`if (false) ...`)
- Dead loop removal (`while(false) ...`)
- Block-aware compilation via Tree metadata (`BLOCK_HINT`)

## API

See: `v16-api.document`

## Quick Start

```bash
npm test
npm start
```

Run your own source file:

```bash
npm start ./example.js
```
