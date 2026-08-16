const browserGlobal = globalThis as unknown as {
  global: typeof globalThis;
  process: {
    browser: true;
    env: { NODE_ENV: "development" | "production" };
    pid: number;
    version: string;
    versions: Record<string, never>;
    stderr: { isTTY: false; columns: number; getColorDepth: () => number };
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
    emitWarning: (warning: unknown) => void;
  };
  require: (moduleName: string) => unknown;
};

// Ketcher's development dependencies still refer to browser-bundler aliases.
// Install inert browser shims before dynamically importing any dependency, so
// Vite's optimized chunks cannot execute first. These expose no Node APIs.
browserGlobal.global = globalThis;
browserGlobal.process = {
  browser: true,
  env: { NODE_ENV: import.meta.env.PROD ? "production" : "development" },
  pid: 0,
  version: "",
  versions: {},
  stderr: { isTTY: false, columns: 80, getColorDepth: () => 1 },
  nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),
  emitWarning: (warning) => console.warn(warning),
};

void import("raphael").then(({ default: Raphael }) => {
  // Ketcher 3.14 contains one browser-side `require("raphael")` call. This
  // deliberately narrow shim returns only Raphael; it is not Node's require.
  browserGlobal.require = (moduleName: string) => {
    if (moduleName === "raphael") return Raphael;
    throw new Error(`Browser module ${moduleName} is not available.`);
  };
  return import("./main.tsx").then(({ renderApplication }) => renderApplication());
});
