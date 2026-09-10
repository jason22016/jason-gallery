import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dist } from './fixture';

/** Small static test host, including the generated custom 404. No application API. */
export async function serve(directory = dist, port = 0) {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.json': 'application/json' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      let filename = path.resolve(directory, `.${pathname}`);
      if (!filename.startsWith(`${path.resolve(directory)}${path.sep}`) && filename !== path.resolve(directory)) throw new Error('Invalid path');
      const stat = await fs.stat(filename);
      if (stat.isDirectory()) filename = path.join(filename, 'index.html');
      response.setHeader('content-type', types[path.extname(filename)] ?? 'application/octet-stream');
      response.end(await fs.readFile(filename));
    } catch {
      response.statusCode = 404;
      response.setHeader('content-type', 'text/html; charset=utf-8');
      // The standalone Viewer fixture has no Astro 404 page (Chromium may still
      // request /favicon.ico). Always finish the response, without a rejected
      // async request handler escaping into the Node test runner.
      const notFound = await fs.readFile(path.join(directory, '404.html')).catch(() => '<h1>Not found</h1>');
      response.end(notFound);
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log((await serve(dist, 4323)).url);
}
