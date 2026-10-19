// Removes old build output so stale hashed chunks don't pile up in dist/.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
for (const f of readdirSync(dist, { withFileTypes: true })) {
  if (f.isFile()) rmSync(join(dist, f.name));
}
