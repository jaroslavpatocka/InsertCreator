import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.onnx':'application/octet-stream','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const server = http.createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    let file = path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    if((await fs.stat(file)).isDirectory()){
      if(!url.pathname.endsWith('/')){res.writeHead(301,{'Location':url.pathname+'/'+url.search});return res.end();}
      file=path.join(file,'index.html');
    }
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    const body = await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
  } catch {res.writeHead(404);res.end('Nenalezeno');}
});
const port=process.env.PORT===undefined?5173:Number(process.env.PORT);
server.listen(port,'0.0.0.0',()=>console.log('Local: http://localhost:'+server.address().port));
