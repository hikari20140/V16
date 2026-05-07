import { V16Engine } from "./engine/V16Engine.js";

export { V16Engine };

export async function executeWithV16(source, options = {}) {
  const engine = new V16Engine();
  return engine.execute(source, options);
}
