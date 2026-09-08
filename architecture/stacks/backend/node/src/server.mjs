import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
export function createApp() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') response.end(JSON.stringify({ status: 'ok' }));
    else { response.statusCode = 404; response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } })); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createApp().listen(port, process.env.HOST || '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}
