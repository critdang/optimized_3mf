import { cp, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await cp(
  new URL("../web/", import.meta.url),
  new URL("../dist/", import.meta.url),
  {
    recursive: true,
  },
);
