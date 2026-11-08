/* Piper neural TTS running fully on-device (onnxruntime-web + espeak-ng phonemizer, WASM).
   Voices: rhasspy/piper-voices (downloaded once, kept in Cache Storage). */
window.Piper=(()=>{
  const BASE=new URL('tts/',document.baseURI).href;
  let HF='https://huggingface.co/rhasspy/piper-voices/resolve/main/';
  const VOICES={
    es:[{id:'es_AR-daniela-high',name:'Daniela',info:'rioplatense · mujer',path:'es/es_AR/daniela/high/es_AR-daniela-high',mb:114},
        {id:'es_MX-claude-high',name:'Claude',info:'México · hombre',path:'es/es_MX/claude/high/es_MX-claude-high',mb:63},
        {id:'es_ES-davefx-medium',name:'Davefx',info:'España · hombre',path:'es/es_ES/davefx/medium/es_ES-davefx-medium',mb:63}],
    en:[{id:'en_GB-alba-medium',name:'Alba',info:'UK · woman',path:'en/en_GB/alba/medium/en_GB-alba-medium',mb:63},
        {id:'en_US-lessac-medium',name:'Lessac',info:'US · woman',path:'en/en_US/lessac/medium/en_US-lessac-medium',mb:63},
        {id:'en_GB-alan-medium',name:'Alan',info:'UK · man',path:'en/en_GB/alan/medium/en_GB-alan-medium',mb:63}],
    pt:[{id:'pt_BR-faber-medium',name:'Faber',info:'Brasil · homem',path:'pt/pt_BR/faber/medium/pt_BR-faber-medium',mb:63}],
    fr:[{id:'fr_FR-siwis-medium',name:'Siwis',info:'France · femme',path:'fr/fr_FR/siwis/medium/fr_FR-siwis-medium',mb:63},
        {id:'fr_FR-tom-medium',name:'Tom',info:'France · homme',path:'fr/fr_FR/tom/medium/fr_FR-tom-medium',mb:64}],
    it:[{id:'it_IT-paola-medium',name:'Paola',info:'Italia · donna',path:'it/it_IT/paola/medium/it_IT-paola-medium',mb:64}],
    de:[{id:'de_DE-thorsten-medium',name:'Thorsten',info:'Deutschland · Mann',path:'de/de_DE/thorsten/medium/de_DE-thorsten-medium',mb:63}],
    ru:[{id:'ru_RU-irina-medium',name:'Irina',info:'женщина',path:'ru/ru_RU/irina/medium/ru_RU-irina-medium',mb:63},
        {id:'ru_RU-dmitri-medium',name:'Dmitri',info:'мужчина',path:'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium',mb:63}],
    uk:[{id:'uk_UA-tetiana-high',name:'Tetiana',info:'жінка',path:'uk/uk_UA/tetiana/high/uk_UA-tetiana-high',mb:114}],
    el:[{id:'el_GR-rapunzelina-medium',name:'Rapunzelina',info:'γυναίκα',path:'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium',mb:63}],
    zh:[{id:'zh_CN-huayan-medium',name:'Huayan',info:'女声',path:'zh/zh_CN/huayan/medium/zh_CN-huayan-medium',mb:63}],
    vi:[{id:'vi_VN-vais1000-medium',name:'Vais',info:'giọng nữ',path:'vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium',mb:63}],
    ar:[{id:'ar_JO-kareem-medium',name:'Kareem',info:'رجل',path:'ar/ar_JO/kareem/medium/ar_JO-kareem-medium',mb:63}]
  };
  const byId={}; Object.values(VOICES).flat().forEach(v=>byId[v.id]=v);
  const CACHE='piper-voices-v1';
  let ortP=null, phonP=null, phon=null, lines=[];
  const sessions={}, cfgs={};
  function script(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('load '+src));document.head.appendChild(s);});}
  function initOrt(){ return ortP||(ortP=(async()=>{ await script(BASE+'ort.wasm.min.js');
    /* Load the module glue as a JS blob so it works even where .mjs is served with a generic MIME type (Android WebView). */
    let mjs=BASE+'ort-wasm-simd-threaded.mjs';
    try{ const code=await (await fetch(mjs)).text(); mjs=URL.createObjectURL(new Blob([code],{type:'text/javascript'})); }catch(e){}
    ort.env.wasm.wasmPaths={mjs,wasm:BASE+'ort-wasm-simd-threaded.wasm'}; ort.env.wasm.numThreads=1; ort.env.wasm.proxy=false; })()); }
  function initPhon(){ return phonP||(phonP=(async()=>{ await script(BASE+'piper_phonemize.js');
    phon=await createPiperPhonemize({print:l=>lines.push(l),printErr:()=>{},locateFile:f=>BASE+f}); })()); }
  function phonemize(text,voice){ lines=[]; phon.callMain(['-l',voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
    const out=[]; for(const l of lines){ try{ const j=JSON.parse(l); if(j.phoneme_ids&&j.phoneme_ids.length) out.push(j.phoneme_ids); }catch(e){} } return out; }
  async function cacheGet(url){ try{ const c=await caches.open(CACHE); const r=await c.match(url); return r||null; }catch(e){ return null; } }
  async function cachePut(url,blob){ try{ const c=await caches.open(CACHE); await c.put(url,new Response(blob)); }catch(e){} }
  async function fetchStore(url,onProg){
    const hit=await cacheGet(url); if(hit) return await hit.blob();
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const total=+r.headers.get('content-length')||0; const reader=r.body&&r.body.getReader();
    let blob;
    if(reader){ const parts=[]; let got=0; for(;;){ const {done,value}=await reader.read(); if(done) break; parts.push(value); got+=value.length; onProg&&total&&onProg(got/total); } blob=new Blob(parts); }
    else blob=await r.blob();
    await cachePut(url,blob); return blob;
  }
  const urls=v=>[HF+v.path+'.onnx',HF+v.path+'.onnx.json'];
  async function isDownloaded(id){ const v=byId[id]; if(!v) return false; return !!(await cacheGet(urls(v)[0])); }
  async function download(id,onProg){ const v=byId[id]; const [m,j]=urls(v); await fetchStore(j); await fetchStore(m,onProg); }
  async function remove(id){ const v=byId[id]; delete sessions[id]; try{ const c=await caches.open(CACHE); for(const u of urls(v)) await c.delete(u); }catch(e){} }
  async function load(id,onProg){
    const v=byId[id]; if(sessions[id]) return;
    await Promise.all([initOrt(),initPhon()]);
    const [m,j]=urls(v);
    cfgs[id]=JSON.parse(await (await fetchStore(j)).text());
    const buf=await (await fetchStore(m,onProg)).arrayBuffer();
    sessions[id]=await ort.InferenceSession.create(buf,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  }
  async function synth(id,text,rate){
    await load(id); const cfg=cfgs[id], s=sessions[id], sr=cfg.audio.sample_rate;
    const parts=phonemize(text,cfg.espeak.voice); const chunks=[]; const gap=new Float32Array(Math.round(sr*0.18));
    for(const ids of parts){
      const feeds={input:new ort.Tensor('int64',BigInt64Array.from(ids,x=>BigInt(x)),[1,ids.length]),
        input_lengths:new ort.Tensor('int64',BigInt64Array.from([BigInt(ids.length)]),[1]),
        scales:new ort.Tensor('float32',Float32Array.from([cfg.inference.noise_scale,cfg.inference.length_scale*1.08/(rate||1),cfg.inference.noise_w]),[3])};
      if((cfg.num_speakers||1)>1) feeds.sid=new ort.Tensor('int64',BigInt64Array.from([0n]),[1]);
      const r=await s.run(feeds); chunks.push(r.output.data,gap);
    }
    let n=0; chunks.forEach(c=>n+=c.length); const pcm=new Float32Array(n); let o=0; chunks.forEach(c=>{pcm.set(c,o);o+=c.length;});
    return {pcm,sr};
  }
  let ctx=null, src=null;
  function audio(){ if(!ctx){ const C=window.AudioContext||window.webkitAudioContext; ctx=new C(); } if(ctx.state==='suspended') ctx.resume(); return ctx; }
  function play({pcm,sr}){ return new Promise(res=>{ const a=audio(); const b=a.createBuffer(1,pcm.length,sr); b.copyToChannel(pcm,0);
    src=a.createBufferSource(); src.buffer=b; src.connect(a.destination); const me=src; src.onended=()=>{ if(src===me) src=null; res(); }; src.start(); }); }
  function stop(){ if(src){ const s=src; src=null; try{s.onended=null;s.stop();}catch(e){} } }
  return {VOICES,byId,isDownloaded,download,remove,load,synth,play,stop,audio,phonemize:(t,v)=>phonemize(t,v),_setBase:u=>HF=u,_init:()=>Promise.all([initOrt(),initPhon()])};
})();
