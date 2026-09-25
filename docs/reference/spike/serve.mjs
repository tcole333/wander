import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.pmtiles':'application/octet-stream' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (p.endsWith('/')) p += 'index.html';
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('nf'); }
    const type = types[path.extname(p)] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (range) {
      const start = +range[1]; const end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(p, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      fs.createReadStream(p).pipe(res);
    }
  });
}).listen(8791, '127.0.0.1', () => console.log('spike on http://127.0.0.1:8791/'));
