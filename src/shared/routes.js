export function parseRoute(value=''){
  const raw=String(value).replace(/^#/,'')||'/';
  if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\'))return {path:'/missing',params:new URLSearchParams()};
  try{const url=new URL(raw,'https://route.invalid');return {path:url.pathname,params:url.searchParams};}
  catch{return {path:'/missing',params:new URLSearchParams()};}
}
export function routeUrl(value,baseUrl){
  const raw=String(value).replace(/^#/,'')||'/';
  const parsed=parseRoute(raw);const url=new URL(baseUrl);
  url.hash=parsed.path==='/missing'?'/missing':parsed.path+(parsed.params.size?'?'+parsed.params.toString():'');
  return url;
}
