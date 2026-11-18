import { createServer } from 'node:http';
import nodeHandler from './platform/node.js';
const server = createServer(
  { maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 },
  (req, res) => {
    nodeHandler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400, { 'cache-control': 'no-store' });
      res.end();
    });
  },
);
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
  console.info('Internal backend listening; no provider workers enabled.'),
);
