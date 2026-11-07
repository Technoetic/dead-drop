import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {APP,build} from './build.mjs';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
export function createStaticServer({root=path.join(APP,'dist'),prefix='/dead-drop/',rootProvider=null,before=null}={}){
  return http.createServer(async(request,response)=>{
    try{
      if(before&&await before(request,response))return;
      const url=new URL(request.url,'http://127.0.0.1');
      if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end('Method not allowed');return;}
      if(url.pathname==='/'||url.pathname===prefix.slice(0,-1)){response.writeHead(302,{Location:prefix,'Cache-Control':'no-store'});response.end();return;}
      if(!url.pathname.startsWith(prefix)){response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end('Not found');return;}
      const currentRoot=path.resolve(rootProvider?await rootProvider(request):root);
      const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
      const file=path.resolve(currentRoot,relative);
      if(!file.startsWith(currentRoot+path.sep)){response.writeHead(404);response.end('Not found');return;}
      const info=await stat(file).catch(()=>null);
      if(!info?.isFile()){response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end('Not found');return;}
      const body=await readFile(file);const extension=path.extname(file);const etag='"'+createHash('sha256').update(body).digest('hex')+'"';
      const immutable=relative.startsWith('assets/');
      const headers={'Content-Type':types[extension]||'application/octet-stream','Content-Length':body.length,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-store',ETag:etag,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
      if(extension==='.html')headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
      if(immutable&&request.headers['if-none-match']===etag){response.writeHead(304,headers);response.end();return;}
      response.writeHead(200,headers);response.end(request.method==='HEAD'?undefined:body);
    }catch(error){response.writeHead(error instanceof URIError?400:500,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end(error instanceof URIError?'Invalid path':'Unable to serve this file');}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await build();const i=process.argv.indexOf('--port');const port=i>=0?Number(process.argv[i+1]):8807;
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  const server=createStaticServer();server.listen(port,'127.0.0.1',()=>console.log(`DEAD / DROP Local: http://127.0.0.1:${port}/dead-drop/`));
}
