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

  let busy = false, timer = null;
  async function run(){
    const c = cfg(); if(!c || busy) return { changed: false, off: !c };
    busy = true;
    try{
      const j = await (await gh(c, '/gists/' + c.g)).json();
      const f = j.files && j.files[FILE];
      let R = null;
      if(f){ let txt = f.content; if(f.truncated || txt == null) txt = await (await fetch(f.raw_url)).text(); try{ R = JSON.parse(txt); }catch(e){} }
      const Lf = read('forge_v2'), Li = read('ielts:planChecks');
      const F = mergeForge(Lf, R && R.forge), I = mergeChecks(Li, R && R.ieltsChecks);
      const changed = JSON.stringify(F) !== JSON.stringify(Lf) || JSON.stringify(I) !== JSON.stringify(Li || {});
      if(F) write('forge_v2', F);
      write('ielts:planChecks', I);
      const Fs = F ? { ...F } : null; if(Fs) delete Fs.curWk;          // une séance en cours reste sur son appareil
      const merged = { v: 1, forge: Fs, ieltsChecks: I };
      const remoteSame = R && JSON.stringify({ v: 1, forge: R.forge, ieltsChecks: R.ieltsChecks }) === JSON.stringify(merged);
      if(!remoteSame){
        await gh(c, '/gists/' + c.g, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ ...merged, ts: Date.now() }) } } }) });
      }
      return { changed };
    }catch(e){ return { changed: false, error: String(e) }; }
    finally{ busy = false; }
  }
  /* une modification locale part dans les 5 secondes */
  function soon(ms){ clearTimeout(timer); timer = setTimeout(run, ms == null ? 5000 : ms); }
  window.AppsSync = { run, soon, mergeForge, enabled: () => !!cfg() };
})();
