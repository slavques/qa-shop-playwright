import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shopDir = resolve(process.env.SHOP_DIR || '../qa-shop');
const entryPoint = join(shopDir, 'server.js');

if (!existsSync(entryPoint)) {
  throw new Error(`Shop source not found at ${entryPoint}. Set SHOP_DIR to the extracted qa-shop directory.`);
}

const dataDir = mkdtempSync(join(tmpdir(), 'lavka-playwright-'));
process.once('exit', () => rmSync(dataDir, { recursive: true, force: true }));
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));

process.env.DATA_DIR = dataDir;
process.env.PORT = process.env.SHOP_PORT ?? '3100';
process.env.ALLOW_TEST_RESET = '0';

await import(pathToFileURL(entryPoint).href);
