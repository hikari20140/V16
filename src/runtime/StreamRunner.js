import { once } from "node:events";

export class BytecodeVM {
  constructor({ logger = console.log } = {}) {
    this.logger = logger;
    this.env = new Map();
    this.stack = [];
    this.outputs = [];
  }

  execute(instruction) {
    switch (instruction.op) {
      case "DECLARE":
        if (!this.env.has(instruction.name)) {
          this.env.set(instruction.name, undefined);
        }
        return;
      case "PUSH_CONST":
        this.stack.push(instruction.value);
        return;
      case "LOAD":
        this.stack.push(this.env.get(instruction.name));
        return;
      case "STORE": {
        const value = this.stack.pop();
        this.env.set(instruction.name, value);
        return;
      }
      case "ADD":
      case "SUB":
      case "MUL":
      case "DIV": {
        const right = this.stack.pop();
        const left = this.stack.pop();
        this.stack.push(executeBinary(instruction.op, left, right));
        return;
      }
      case "PRINT": {
        const argc = instruction.argc ?? 0;
        const args = [];
        for (let i = 0; i < argc; i += 1) {
          args.push(this.stack.pop());
        }
        args.reverse();
        this.outputs.push(args);
        this.logger(...args);
        return;
      }
      case "POP":
        this.stack.pop();
        return;
      default:
        throw new Error(`Unknown opcode: ${instruction.op}`);
    }
  }
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
    default:
      throw new Error(`Unknown arithmetic opcode: ${op}`);
  }
}

export async function runBinaryStream(stream, vm) {
  let pending = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    processPending();
  });

  const processPending = () => {
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).trim();
      pending = pending.slice(newlineIndex + 1);
      if (line.length > 0) {
        vm.execute(JSON.parse(line));
      }
      newlineIndex = pending.indexOf("\n");
    }
  };

  if (stream.readableEnded) {
    processPending();
  } else {
    await once(stream, "end");
    processPending();
  }

  return {
    env: Object.fromEntries(vm.env.entries()),
    outputs: vm.outputs
  };
}
