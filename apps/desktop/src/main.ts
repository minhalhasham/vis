import Raphael from "raphael";

// Ketcher 3.14 contains one browser-side `require("raphael")` call in its
// published ESM bundle. This deliberately narrow compatibility shim returns
// only Raphael; it is not Node's require and exposes no privileged API.
const browserGlobal = globalThis as unknown as {
  global: typeof globalThis;
  require: (moduleName: string) => unknown;
};
// Ketcher's Redux store still refers to the conventional browser bundler
// `global` alias. Point it at the ordinary browser global, not Node.
browserGlobal.global = globalThis;
browserGlobal.require = (moduleName: string) => {
  if (moduleName === "raphael") return Raphael;
  throw new Error(`Browser module ${moduleName} is not available.`);
};

void import("./main.tsx").then(({ renderApplication }) => renderApplication());
