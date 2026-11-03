import path from 'node:path';
import { createServer } from '../server.mjs';
const server = await createServer({ dataDir: path.resolve('test-results', `rooms-${process.pid}`) });
server.listen(3100, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
