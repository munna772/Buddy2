import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(
  new URL('../node_modules/@capacitor/cli/dist/util/template.js', import.meta.url)
);

let source = await readFile(templatePath, 'utf8');
const original = source;

// Capacitor CLI 6 imports tar as a default export. tar 7 exposes named
// exports, so use the supported named extract() export instead.
source = source.replace(
  /import\s+tar\s+from\s+(['"])tar\1\s*;?/g,
  'import { extract } from "tar";'
);
source = source.replace(/\bawait\s+tar\.extract\(/g, 'await extract(');

// Also handle TypeScript's CommonJS output should the CLI package ship it.
source = source.replace(
  /((?:const|let|var)\s+tar_1\s*=\s*)__importDefault\(require\((['"])tar\2\)\)/g,
  '$1require("tar")'
);
source = source.replace(/\btar_1\.default\.extract\(/g, 'tar_1.extract(');

if (source === original || /(?:tar_1\.default|tar)\.extract\(/.test(source)) {
  throw new Error('Could not safely patch the installed Capacitor tar import.');
}

await writeFile(templatePath, source, 'utf8');
console.log('Patched Capacitor CLI template extraction to use tar.extract safely.');
