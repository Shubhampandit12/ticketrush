// Minimal zero-dependency static file server for the portal.
const http = require('http');
const fs = require('fs');
const path = require('path');

// PORT takes precedence: hosts like Render inject it and expect the app to
// bind there regardless of app-specific env var names.
const PORT = process.env.PORT || process.env.PORTAL_PORT || 4000;
const ROOT = __dirname;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`portal listening on :${PORT}`));
