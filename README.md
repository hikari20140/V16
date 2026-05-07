# V16

V16 is a new JavaScript execution engine prototype with a four-stage pipeline:

1. Parse
2. Tree
3. JIT Compile
4. Run

## Architecture

- `Parse` and `Tree` run in parallel worker threads.
- `JIT Compile` transforms AST into V16 bytecode instructions.
- `Run` executes the generated binary through a stream-powered VM.

## Supported JS Subset (Current Prototype)

- `let` / `const` / `var` declarations
- Numeric and string literals
- Arithmetic operators: `+ - * /`
- Assignments to identifiers
- Calls: `print(...)` and `console.log(...)`

## Quick Start

```bash
npm test
npm start
```

Run with your own source file:

```bash
npm start ./example.js
```
