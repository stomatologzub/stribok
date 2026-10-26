/* Lokálny simulátor runtime-u claude.ai (window.claude.use): db, user, assets – len na vývoj a testovanie. */
(()=>{
 const docs=new Map(); const subs=[];
 const isDoc=p=>p.split('/').length%2===0;
 const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
 function notify(){subs.forEach(s=>s.fire())}
 function snap(path){const d=docs.get(path);return {id:path.split('/').pop(),exists:!!d,data:()=>clone(d),metadata:{fromCache:false,hasPendingWrites:false}}}
 function docRef(path){return {id:path.split('/').pop(),path,
   get:async()=>snap(path),
   set:async(d)=>{docs.set(path,clone(d));setTimeout(notify,0)},
   update:async(d)=>{if(!docs.has(path)){const e=new Error('x');e.code='invalid_argument';throw e}docs.set(path,{...docs.get(path),...clone(d)});setTimeout(notify,0)},
   delete:async()=>{docs.delete(path);setTimeout(notify,0)},
   onSnapshot:(next)=>{const s={fire:()=>next(snap(path))};subs.push(s);setTimeout(s.fire,0);return ()=>{}},
   collection:(c)=>colRef(path+'/'+c)}}
 function colRef(path){const q={path,
   where:()=>q,orderBy:()=>q,limit:()=>q,
   get:async()=>qs(path),
   onSnapshot:(next)=>{const s={fire:()=>next(qs(path))};subs.push(s);setTimeout(s.fire,0);return ()=>{}},
   doc:(id)=>docRef(path+'/'+(id||Math.random().toString(36).slice(2,10))),
   add:async(d)=>{const r=docRef(path+'/'+Math.random().toString(36).slice(2,10));await r.set(d);return r}};return q}
 function qs(path){const n=path.split('/').length+1;const ds=[...docs.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===n).sort().map(snap);return {docs:ds,size:ds.length,empty:!ds.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}}
 const db={doc:docRef,collection:colRef};
 window.__docs=docs;
 const ADMIN=window.__ADMIN!==undefined?window.__ADMIN!==false:!/[?&]role=worker/.test(location.search);
 const av=c=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10' fill='${c}'/></svg>`)}`;
 const P={u_me:{id:'u_me',name:'Admin Demo',avatarUrl:av('#a88e62'),color:'#a88e62',email:null,isMe:true,guest:false},u_jano:{id:'u_jano',name:'Technik Demo',avatarUrl:av('#567'),color:'#567',email:null,isMe:false,guest:false}};
 const user={me:async()=>({id:'u_me',name:'Admin Demo',avatarUrl:P.u_me.avatarUrl,color:'#a88e62',email:null,isOwner:ADMIN,canEdit:ADMIN}),
  id:async()=>'u_me',canEdit:async()=>ADMIN,isOwner:async()=>ADMIN,can:async()=>true,
  profiles:async(ids)=>{const o={};[].concat(ids).forEach(i=>o[i]=P[i]||{id:i,name:'',avatarUrl:av('#999'),color:'#999',email:null,isMe:false,guest:false});return o},
  search:async(q)=>Object.values(P).filter(p=>!q||p.name.toLowerCase().includes(q.toLowerCase()))};
 const assets={upload:async(b)=>({id:'a'.repeat(32),url:'/_blob/x',sizeBytes:b.size,contentType:'image/jpeg'})};
 const downloads={save:async({filename,data})=>{window.__download={filename,data};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data]));a.download=filename;a.click();return {saved:true}}};
 window.claude={use:async(n)=>({db,user,assets,downloads,comments:null}[n]??null)};
})();
