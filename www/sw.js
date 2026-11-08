/* Sagrada Biblia — service worker: works offline after first visit. */
const SHELL='biblia-shell-v3', DATA='biblia-data-v1', FONTS='biblia-fonts-v1';
const SHELL_FILES=['./','index.html','manifest.webmanifest','data/versions.json','data/encyclicals.json','data/apoc/index.json',
  'icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(SHELL_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>![SHELL,DATA,FONTS].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  if(u.origin===location.origin){
    // Bible data never changes for a given file name: cache first.
    if((/\/data\/(chunks|notes|apoc|i18n)\//.test(u.pathname)||/\/tts\/(?!piper\.js)/.test(u.pathname))&&!/apoc\/index/.test(u.pathname)){
      e.respondWith(caches.open(DATA).then(async c=>{const hit=await c.match(e.request); if(hit) return hit; const r=await fetch(e.request); if(r.ok) c.put(e.request,r.clone()); return r;}));
      return;
    }
    // App shell: network first so updates arrive, cache as fallback offline.
    e.respondWith(fetch(e.request).then(r=>{ if(r.ok){const cl=r.clone(); caches.open(SHELL).then(c=>c.put(e.request,cl));} return r; })
      .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(h=>h||caches.match('index.html'))));
    return;
  }
  if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
    e.respondWith(caches.open(FONTS).then(async c=>{const hit=await c.match(e.request); const net=fetch(e.request).then(r=>{c.put(e.request,r.clone());return r;}).catch(()=>hit); return hit||net;}));
  }
});
