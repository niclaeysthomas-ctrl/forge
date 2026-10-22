/* ═══════════════════════════════════════════════════════════════════
   SYNCHRO ENTRE APPAREILS — FORGE (séances) + cases du programme IELTS
   Les apps vivent dans le navigateur : sur le téléphone et sur l'ordi, ce
   sont deux mémoires différentes. Ce module les réunit dans le même coffre
   privé que Le Pointage (un gist GitHub secret), fichier « apps-sync.json ».
   Il réutilise le jeton et le coffre déjà réglés dans Le Pointage : rien à
   configurer. Fusion sans perte : on additionne les séances des deux côtés,
   on ne supprime jamais rien.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  const FILE = 'apps-sync.json', TOK = 'pointage_gh_token';
  function cfg(){
    try{
      const t = localStorage.getItem(TOK) || '';
      const p = JSON.parse(localStorage.getItem('pointage_v1') || '{}');
      const g = p && p.sync && p.sync.gist;
      return t && g ? { t, g } : null;
    }catch(e){ return null; }
  }
  async function gh(c, path, opt){
    opt = opt || {};
    const r = await fetch('https://api.github.com' + path, { ...opt, headers: {
      Authorization: 'Bearer ' + c.t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if(!r.ok) throw new Error('GitHub ' + r.status);
    return r;
  }
  const read = k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } };
  const write = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  const key = x => (x && x.id != null) ? 'id:' + x.id : JSON.stringify(x);
  function unionArr(a, b){
    const m = new Map();
    (a || []).forEach(x => m.set(key(x), x));
    (b || []).forEach(x => { if(!m.has(key(x))) m.set(key(x), x); });
    return [...m.values()].sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')) || ((x.id || 0) - (y.id || 0)));
  }
  /* fusion de deux états FORGE : rien ne se perd */
  function mergeForge(L, R){
    if(!R) return L;
    if(!L) return R;
    const out = JSON.parse(JSON.stringify(L));
    const newer = (R.mod || 0) > (L.mod || 0);
    ['workoutLog', 'mobLog', 'boxeLog', 'journal', 'floorTests'].forEach(k => { out[k] = unionArr(L[k], R[k]); });
    out.planDone = JSON.parse(JSON.stringify(R.planDone || {}));
    Object.entries(L.planDone || {}).forEach(([d, o]) => { out.planDone[d] = { ...(out.planDone[d] || {}), ...o }; });
    out.prReps = { ...(L.prReps || {}) };
    Object.entries(R.prReps || {}).forEach(([k, v]) => { const o = out.prReps[k]; if(!o || (v && v.reps > o.reps)) out.prReps[k] = v; });
    const Lc = L.cali || {}, Rc = R.cali || {};
    const c = out.cali = JSON.parse(JSON.stringify(newer ? { ...Lc, ...Rc } : { ...Rc, ...Lc }));
    c.hist = unionArr(Lc.hist, Rc.hist);
    if(newer){ ['restDur', 'bx'].forEach(k => { if(R[k] !== undefined) out[k] = R[k]; }); }
    /* le plan du jour est un cache : s'il manquait une séance d'un autre appareil,
       on le recalcule à partir du journal fusionné */
    if(JSON.stringify(out.workoutLog) !== JSON.stringify(L.workoutLog || []) || JSON.stringify(out.boxeLog) !== JSON.stringify(L.boxeLog || [])){
      const n = new Date(), today = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      Object.keys(c.days || {}).forEach(d => { if(d >= today) delete c.days[d]; });
    }
    out.mod = Math.max(L.mod || 0, R.mod || 0);
    return out;
  }
  const mergeChecks = (L, R) => ({ ...(R || {}), ...(L || {}) });   // une case cochée sur un appareil reste cochée

  /* ── fusion générique à trois voies ─────────────────────────────────
     « base » = l'état au dernier échange réussi, gardé sur l'appareil.
     Un côté qui n'a pas bougé depuis la base cède à l'autre (y compris
     pour une suppression : une erreur corrigée ne revient pas d'entre les
     morts). Si les deux ont bougé : on additionne, carte par carte. */
  const J = x => JSON.stringify(x);
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const DATE = /^\d{4}-\d{2}-\d{2}/;
  const NEWER_WINS = { level: 1, audioSpeed: 1, menu: 1, transDir: 1, cur: 1, theme: 1, slowAudio: 1, cardMute: 1 };
  function m3(b, l, r, k){
    if(J(l) === J(r)) return l;
    if(b !== undefined && J(l) === J(b)) return r;
    if(b !== undefined && J(r) === J(b)) return l;
    if(l === undefined) return r;
    if(r === undefined) return l;
    if(Array.isArray(l) && Array.isArray(r)){
      const bk = new Set((Array.isArray(b) ? b : []).map(key)), lk = new Set(l.map(key)), rk = new Set(r.map(key));
      const out = l.filter(x => rk.has(key(x)) || !bk.has(key(x)));        // retiré de l'autre côté → retiré
      r.forEach(x => { if(!lk.has(key(x)) && !bk.has(key(x))) out.push(x); }); // ajouté de l'autre côté → ajouté
      return out;
    }
    if(isObj(l) && isObj(r)){
      if('due' in l || 'due' in r) return (r.due || 0) > (l.due || 0) ? r : l;          // une carte : la plus avancée
      if(typeof l.date === 'string' && typeof r.date === 'string' && l.date !== r.date) return l.date > r.date ? l : r;  // compteurs du jour
      const o = {}, bb = isObj(b) ? b : {};
      new Set([...Object.keys(l), ...Object.keys(r)]).forEach(x => { const v = m3(bb[x], l[x], r[x], x); if(v !== undefined) o[x] = v; });
      return o;
    }
    if(NEWER_WINS[k]) return r;
    if(typeof l === 'number' && typeof r === 'number') return Math.max(l, r);
    if(typeof l === 'string' && typeof r === 'string' && DATE.test(l) && DATE.test(r)) return l > r ? l : r;
    return l;
  }
  /* les apps synchronisées, chacune dans son fichier du coffre */
  const UNITS = {
    ielts:   { file: 'app-ielts.json',   keys: () => Object.keys(localStorage).filter(k => k.indexOf('ielts:') === 0 && k !== 'ielts:planChecks') },
    t990:    { file: 'app-990.json',     keys: () => ['t990'] },
    tcumbre: { file: 'app-cumbre.json',  keys: () => ['tcumbre'] },
    closing: { file: 'app-closing.json', keys: () => ['closing_v1'] }
  };
  const BASE = 'appsync_base:';
  async function getFile(f){
    if(!f) return null;
    let txt = f.content; if(f.truncated || txt == null) txt = await (await fetch(f.raw_url)).text();
    try{ return JSON.parse(txt); }catch(e){ return null; }
  }
  function mergeUnit(name, R){
    const U = UNITS[name], rd = (R && R.data) || {}, base = read(BASE + name) || {};
    const keys = new Set([...U.keys(), ...Object.keys(rd)]);
    const data = {}; let changed = false;
    keys.forEach(k => {
      let raw = null; try{ raw = localStorage.getItem(k); }catch(e){}
      let L; if(raw != null){ try{ L = JSON.parse(raw); }catch(e){ return; } }   // illisible : on n'y touche pas
      const v = m3(base[k], L, rd[k], k);
      if(v === undefined) return;
      data[k] = v;
      if(J(v) !== J(L)){ write(k, v); changed = true; }
    });
    return { data, changed, same: R && J(R.data) === J(data) };
  }

  let busy = false, timer = null, pend = new Set(); const listeners = [];
  /* run()            → FORGE + cases IELTS (Le Pointage, FORGE)
     run(['t990'])    → une app précise ; 'forge' reste disponible dans la liste */
  async function run(list){
    list = list || ['forge'];
    const c = cfg(); if(!c) return { changed: false, off: true };
    if(busy){ list.forEach(x => pend.add(x)); return { changed: false, busy: true }; }
    busy = true;
    try{
      const j = await (await gh(c, '/gists/' + c.g)).json(), files = j.files || {}, out = {}, bases = {};
      /* on télécharge tout d'abord, puis on fusionne d'un seul tenant : l'app
         ne peut pas sauvegarder entre l'écriture et sa mise à jour en mémoire */
      const Rs = {};
      for(const name of list){ const f = name === 'forge' ? FILE : (UNITS[name] || {}).file; if(f) Rs[name] = await getFile(files[f]); }
      let changed = false; const touched = [];
      for(const name of list){
        if(name === 'forge'){
          const R = Rs.forge;
          const Lf = read('forge_v2'), Li = read('ielts:planChecks');
          const F = mergeForge(Lf, R && R.forge), I = mergeChecks(Li, R && R.ieltsChecks);
          if(J(F) !== J(Lf) || J(I) !== J(Li || {})){ changed = true; touched.push('forge'); }
          if(F) write('forge_v2', F);
          write('ielts:planChecks', I);
          const Fs = F ? { ...F } : null; if(Fs) delete Fs.curWk;          // une séance en cours reste sur son appareil
          const merged = { v: 1, forge: Fs, ieltsChecks: I };
          if(!(R && J({ v: 1, forge: R.forge, ieltsChecks: R.ieltsChecks }) === J(merged))) out[FILE] = { content: J({ ...merged, ts: Date.now() }) };
          continue;
        }
        const U = UNITS[name]; if(!U) continue;
        const r = mergeUnit(name, Rs[name]);
        if(r.changed){ changed = true; touched.push(name); }
        if(!r.same) out[U.file] = { content: J({ v: 1, ts: Date.now(), data: r.data }) };
        bases[name] = r.data;
      }
      if(touched.length) listeners.forEach(fn => { try{ fn(touched); }catch(e){} });
      if(Object.keys(out).length) await gh(c, '/gists/' + c.g, { method: 'PATCH', body: J({ files: out }) });
      /* la base n'avance qu'une fois le coffre à jour */
      Object.entries(bases).forEach(([n, d]) => { try{ localStorage.setItem(BASE + n, J(d)); }catch(e){ try{ localStorage.removeItem(BASE + n); }catch(_){} } });
      return { changed };
    }catch(e){ return { changed: false, error: String(e) }; }
    finally{
      busy = false;
      if(pend.size){ const p = [...pend]; pend.clear(); setTimeout(() => run(p), 300); }
    }
  }
  /* une modification locale part dans les 5 secondes */
  let soonList = new Set();
  function soon(ms, list){
    (list || ['forge']).forEach(x => soonList.add(x));
    clearTimeout(timer);
    timer = setTimeout(() => { const l = [...soonList]; soonList.clear(); run(l); }, ms == null ? 5000 : ms);
  }
  window.AppsSync = { run, soon, mergeForge, m3, onChange: fn => listeners.push(fn), enabled: () => !!cfg() };
})();
