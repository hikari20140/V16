V16 API Document

1) Engine Entry Point
- class: V16Engine
- method: async execute(source, options?)

2) execute options
- chunkSize: number (default: 96)
- logger: (...args) => void (default: console.log)
- modules: Record<string, Record<string, unknown>>
- moduleName: string (default: "main")

3) Grammar subset (current)
- Variable declarations: var / let / const
- Function declaration and return
- If / else
- While
- Import / export
  - import defaultExport from "mod"
  - import { a, b as c } from "mod"
  - import * as ns from "mod"
  - export const x = ...
  - export function f() {}
  - export { x as y }
  - export default expression
- Expressions
  - literals: number / string / true / false / null
  - arithmetic: + - * /
  - compare: < > <= >= == !=
  - unary: - !
  - assignment: a = ...
  - call: print(...), console.log(...), user-defined function calls

4) Runtime result shape
- runtime.env: global binding snapshot
- runtime.outputs: list of printed argument arrays
- runtime.exports: module export object
- stages: parse / tree / jit / run metrics
- artifacts: tokens / ast / tree / instructions

5) Pipeline
- Parse and Tree run in parallel worker threads
- JIT compiles AST to V16 bytecode
- bytecode is streamed and executed by VM
