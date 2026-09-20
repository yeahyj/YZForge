import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, isAbsolute } from 'node:path';
const root=fileURLToPath(new URL('../../build/web-mobile/',import.meta.url)),requests=[];
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.wav':'audio/wav','.css':'text/css'};
const server=createServer(async(req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/__requests'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
    const file=resolve(root,'.'+(name==='/'?'/index.html':name)),local=relative(root,file);
    if(local.startsWith('..')||isAbsolute(local))throw Error('Invalid path');
    const bytes=await readFile(file);requests.push(name);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(bytes);
  }catch{res.statusCode=404;res.end('Not found');}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,root})));
