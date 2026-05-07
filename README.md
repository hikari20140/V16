# V16

V16 is a JavaScript execution engine prototype with this pipeline:

1. Parse
2. Tree
3. JIT Compile
4. Run

## Grammar Subset

- Declarations: `var`, `let`, `const`
- Functions:
  - `function` declaration
  - anonymous function expression
  - arrow function expression
  - closure capture (lexical scope)
- Control flow:
  - `if / else`
  - `while`
  - `for`
  - `break`, `continue`
- Module syntax:
  - `import`, `export`, `export default`
- Expressions:
  - arithmetic: `+ - * /`
  - compare: `< > <= >= == !=`
  - logical: `&& ||`
  - unary: `- !`
  - assignment, member access, call

## JIT Optimizations

- Constant folding
- Pure expression elimination
- Dead branch/loop pruning
- Block CSE (common subexpression reuse inside block)
- Tree-guided LICM on loop test invariants

## CLI Input Integration

- Inject external globals to script:
  - `input`
  - `document`
  - `v16doc`
- Options:
  - `--html <file>`
  - `--input-json '<json>'`
  - `--input-file <file>`
  - `--debug`

See [v16-api-document](/Users/tomonori/Documents/GitHub/V16/v16-api.document.md) for details.

## Quick Start

```bash
npm test
npm start
```

Run your own script:

```bash
npm start ./example.js -- --debug
```
