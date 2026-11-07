export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function el(tag,attrs={},children=[]){
  const node=document.createElement(tag);
  for(const [name,value] of Object.entries(attrs)){
    if(value===null||value===undefined)continue;
    if(name==='children')continue;
    if(name==='on'&&typeof value==='object'){
      for(const [event,handler] of Object.entries(value))if(typeof handler==='function')node.addEventListener(event,handler);
    }else if(/^on[a-z]+$/i.test(name)&&typeof value==='function')node.addEventListener(name.slice(2).toLowerCase(),value);
    else if(name==='dataset'&&typeof value==='object')Object.assign(node.dataset,value);
    else if(name==='style'&&typeof value==='object')Object.assign(node.style,value);
    else if(name==='class'||name==='className')node.className=String(value);
    else if(name==='textContent')node.textContent=String(value);
    else if(['disabled','checked','selected','hidden','value','type','tabIndex','draggable'].includes(name))node[name]=value;
    else if(value===true)node.setAttribute(name,'');
    else if(value!==false||name.startsWith('aria-'))node.setAttribute(name,String(value));
  }
  const content=attrs.children===undefined?children:attrs.children;
  const append=child=>{
    if(child===null||child===undefined||child===false)return;
    if(Array.isArray(child)){child.forEach(append);return;}
    node.append(typeof child==='object'?child:document.createTextNode(String(child)));
  };
  append(content);
  return node;
}

export function icon(name){
  const marks={play:'▶',pause:'Ⅱ',sound:'♪',muted:'×',arrow:'→',check:'✓',close:'×',retry:'↻',swap:'⇄',split:'⑂'};
  return el('span',{'aria-hidden':'true',className:'icon',textContent:marks[name]??'◇'});
}
