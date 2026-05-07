import { once } from "node:events";

class Environment {
  constructor(parent = null, kind = "block") {
    this.parent = parent;
    this.kind = kind;
    this.bindings = new Map();
  }
}

export class BytecodeVM {
  constructor({ logger = console.log, modules = {}, moduleName = "main", globals = {} } = {}) {
    this.logger = logger;
    this.modules = modules;
    this.moduleName = moduleName;
    this.moduleExports = {};
    this.outputs = [];

    this.globalEnv = new Environment(null, "global");
    this.globalEnv.bindings.set("print", (...args) => {
      this.outputs.push(args);
      this.logger(...args);
      return null;
    });
    this.globalEnv.bindings.set("console", {
      log: (...args) => {
        this.outputs.push(args);
        this.logger(...args);
        return null;
      }
    });
    for (const [name, value] of Object.entries(globals)) {
      this.globalEnv.bindings.set(name, value);
    }

    this.lastBlockHint = null;
  }

  run(instructions) {
    const frame = {
      stack: [],
      env: this.globalEnv,
      ip: 0,
      instructions,
      returned: false,
      returnValue: undefined
    };

    this.executeFrame(frame);

    return {
      env: Object.fromEntries(this.globalEnv.bindings.entries()),
      outputs: this.outputs,
      exports: this.moduleExports,
      lastBlockHint: this.lastBlockHint
    };
  }

  executeFrame(frame) {
    while (frame.ip < frame.instructions.length) {
      const instruction = frame.instructions[frame.ip];

      switch (instruction.op) {
        case "BLOCK_HINT":
          this.lastBlockHint = instruction;
          break;
        case "ENTER_SCOPE":
          frame.env = new Environment(frame.env, instruction.kind ?? "block");
          break;
        case "EXIT_SCOPE":
          if (frame.env.parent) {
            frame.env = frame.env.parent;
          }
          break;
        case "DECLARE":
          this.declareBinding(frame.env, instruction.name, instruction.kind ?? "let");
          break;
        case "PUSH_CONST":
          frame.stack.push(instruction.value);
          break;
        case "LOAD":
          frame.stack.push(this.lookupBinding(frame.env, instruction.name));
          break;
        case "STORE": {
          const value = frame.stack.pop();
          this.assignBinding(frame.env, instruction.name, value);
          break;
        }
        case "GET_PROP": {
          const obj = frame.stack.pop();
          frame.stack.push(obj?.[instruction.property]);
          break;
        }
        case "ADD":
        case "SUB":
        case "MUL":
        case "DIV":
        case "LT":
        case "GT":
        case "LTE":
        case "GTE":
        case "EQ":
        case "NEQ": {
          const right = frame.stack.pop();
          const left = frame.stack.pop();
          frame.stack.push(executeBinary(instruction.op, left, right));
          break;
        }
        case "NEG": {
          const value = frame.stack.pop();
          frame.stack.push(-value);
          break;
        }
        case "NOT": {
          const value = frame.stack.pop();
          frame.stack.push(!value);
          break;
        }
        case "DROP":
          frame.stack.pop();
          break;
        case "DUP": {
          const value = frame.stack[frame.stack.length - 1];
          frame.stack.push(value);
          break;
        }
        case "JMP":
          frame.ip = instruction.target;
          continue;
        case "JMP_IF_FALSE": {
          const value = frame.stack.pop();
          if (!value) {
            frame.ip = instruction.target;
            continue;
          }
          break;
        }
        case "PRINT": {
          const args = popArgs(frame.stack, instruction.argc ?? 0);
          this.outputs.push(args);
          this.logger(...args);
          if (!instruction.discardResult) {
            frame.stack.push(null);
          }
          break;
        }
        case "MAKE_FUNCTION": {
          const value = {
            __v16Type: "function",
            name: instruction.name,
            params: instruction.params,
            body: instruction.body,
            closure: frame.env
          };
          frame.stack.push(value);
          break;
        }
        case "CALL_DYNAMIC": {
          const callee = frame.stack.pop();
          const args = popArgs(frame.stack, instruction.argc ?? 0);
          const result = this.callValue(callee, args);
          if (!instruction.discardResult) {
            frame.stack.push(result);
          }
          break;
        }
        case "CALL_MEMBER": {
          const target = frame.stack.pop();
          const args = popArgs(frame.stack, instruction.argc ?? 0);
          const method = target?.[instruction.property];
          if (typeof method !== "function") {
            throw new Error(`Method ${instruction.property} is not callable.`);
          }
          const result = method.apply(target, args);
          if (!instruction.discardResult) {
            frame.stack.push(result);
          }
          break;
        }
        case "RET":
          frame.returned = true;
          frame.returnValue = frame.stack.pop();
          return;
        case "IMPORT":
          this.applyImport(frame.env, instruction.source, instruction.specifiers ?? []);
          break;
        case "EXPORT":
          this.moduleExports[instruction.exported] = this.lookupBinding(frame.env, instruction.local);
          break;
        case "EXPORT_VALUE":
          this.moduleExports[instruction.exported] = frame.stack.pop();
          break;
        default:
          throw new Error(`Unknown opcode: ${instruction.op}`);
      }

      frame.ip += 1;
    }
  }

  callValue(callee, args) {
    if (callee && callee.__v16Type === "function") {
      return this.callUserFunction(callee, args);
    }

    if (typeof callee === "function") {
      return callee(...args);
    }

    if (callee === undefined || callee === null) {
      throw new Error("Attempted to call undefined/null.");
    }

    throw new Error("Unsupported callable value in CALL_DYNAMIC.");
  }

  callUserFunction(callee, args) {
    const localEnv = new Environment(callee.closure, "function");

    if (callee.name) {
      localEnv.bindings.set(callee.name, callee);
    }

    for (let i = 0; i < callee.params.length; i += 1) {
      const name = callee.params[i];
      localEnv.bindings.set(name, args[i]);
    }

    const frame = {
      stack: [],
      env: localEnv,
      ip: 0,
      instructions: callee.body,
      returned: false,
      returnValue: undefined
    };

    this.executeFrame(frame);
    return frame.returned ? frame.returnValue : undefined;
  }

  applyImport(env, source, specifiers) {
    const moduleRecord = this.modules[source] ?? {};

    for (const specifier of specifiers) {
      let value;
      if (specifier.type === "namespace") {
        value = moduleRecord;
      } else {
        value = moduleRecord[specifier.imported];
      }
      this.declareBinding(env, specifier.local, "const");
      this.assignBinding(env, specifier.local, value);
    }
  }

  declareBinding(env, name, kind) {
    const target = kind === "var" ? this.findNearestFunctionScope(env) : env;
    if (!target.bindings.has(name)) {
      target.bindings.set(name, undefined);
    }
  }

  assignBinding(env, name, value) {
    const target = this.resolveScope(env, name);
    if (target) {
      target.bindings.set(name, value);
      return;
    }
    this.globalEnv.bindings.set(name, value);
  }

  lookupBinding(env, name) {
    const target = this.resolveScope(env, name);
    if (target) {
      return target.bindings.get(name);
    }
    return undefined;
  }

  resolveScope(env, name) {
    let current = env;
    while (current) {
      if (current.bindings.has(name)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  findNearestFunctionScope(env) {
    let current = env;
    while (current) {
      if (current.kind === "function" || current.kind === "global") {
        return current;
      }
      current = current.parent;
    }
    return this.globalEnv;
  }
}

function popArgs(stack, argc) {
  const args = [];
  for (let i = 0; i < argc; i += 1) {
    args.push(stack.pop());
  }
  args.reverse();
  return args;
}

function executeBinary(op, left, right) {
  switch (op) {
    case "ADD":
      return left + right;
    case "SUB":
      return left - right;
    case "MUL":
      return left * right;
    case "DIV":
      return left / right;
    case "LT":
      return left < right;
    case "GT":
      return left > right;
    case "LTE":
      return left <= right;
    case "GTE":
      return left >= right;
    case "EQ":
      return left == right; // eslint-disable-line eqeqeq
    case "NEQ":
      return left != right; // eslint-disable-line eqeqeq
    default:
      throw new Error(`Unknown arithmetic opcode: ${op}`);
  }
}

export async function runBinaryStream(stream, vm) {
  const instructions = [];
  let pending = "";

  const processPending = () => {
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).trim();
      pending = pending.slice(newlineIndex + 1);
      if (line.length > 0) {
        instructions.push(JSON.parse(line));
      }
      newlineIndex = pending.indexOf("\n");
    }
  };

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    processPending();
  });

  if (!stream.readableEnded) {
    await once(stream, "end");
  }
  processPending();

  return vm.run(instructions);
}
