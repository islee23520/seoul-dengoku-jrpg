import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function assertServedOutputPrivacy(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await assertServedOutputPrivacy(file);
    else {
      const bytes = await readFile(file);
      const text = bytes.toString('utf8');
      if (/\/(?:private\/var\/folders|tmp|Users|home|var|opt|etc|Volumes)\/|\b[A-Za-z]:\\[A-Za-z0-9_.-]+\\|RUN_TMP/.test(text)
        || (process.env.RUN_TMP && bytes.includes(Buffer.from(path.basename(process.env.RUN_TMP))))) {
        throw new Error('Private filesystem path in served file: ' + file);
      }
    }
  }
}
