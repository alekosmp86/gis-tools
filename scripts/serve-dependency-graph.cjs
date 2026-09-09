/**
 * scripts/serve-dependency-graph.cjs
 *
 * Serves public/dependency-graph.html on http://127.0.0.1:3847
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3847;
const filePath = path.resolve(__dirname, '..', 'public', 'dependency-graph.html');

if (!fs.existsSync(filePath)) {
  console.error('dependency-graph.html not found! Run npm run graph first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dependency Graph Viewer running at http://127.0.0.1:${PORT}`);
});
