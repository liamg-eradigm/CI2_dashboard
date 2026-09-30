// Tests run on Node; the shared package itself has no Node types (it runs in Workers and browsers).
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
