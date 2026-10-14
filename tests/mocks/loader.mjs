import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@minecraft/server') {
    return nextResolve(new URL('./minecraftServer.ts', import.meta.url).href, context);
  }

  if (specifier === '@minecraft/server-ui') {
    return nextResolve(new URL('./minecraftServerUi.ts', import.meta.url).href, context);
  }

  if (specifier.endsWith('.js') && context.parentURL) {
    try {
      const resolved = new URL(specifier, context.parentURL);
      if (resolved.protocol === 'file:') {
        const filePath = fileURLToPath(resolved);
        if (!existsSync(filePath)) {
          const tsPath = filePath.replace(/\.js$/, '.ts');
          if (existsSync(tsPath)) {
            return nextResolve(pathToFileURL(tsPath).href, context);
          }
        }
      }
    } catch {
      // Fall through to nextResolve
    }
  }

  return nextResolve(specifier, context);
}
