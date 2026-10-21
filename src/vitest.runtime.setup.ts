// Bun has a global `Worker` and Node does not. A real worker loads its module
// without the Lingui macro transform vite gives test files, so code that offers
// a worker takes its in-thread path here, as it always has under Node.
Reflect.deleteProperty(globalThis, "Worker");
