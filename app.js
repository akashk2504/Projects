// Lost & Found Management System - Vanilla JS (no backend)
(function(){
  'use strict';

  // ---------- Utilities ----------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const fmtDate = ts => new Date(ts).toLocaleString();
  const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const storage = {
    get(key, def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch{ return def } },
    set(key, val){ localStorage.setItem(key, JSON.stringify(val)) },
    remove(key){ localStorage.removeItem(key) }
  };

  const DB = {
    load(){
      this.lost = storage.get('LFM_lost', []);
      this.found = storage.get('LFM_found', []);
      this.matches = storage.get('LFM_matches', []);
      this.settings = storage.get('LFM_settings', { retentionDays: 120 });
    },
    save(){
      storage.set('LFM_lost', this.lost);
      storage.set('LFM_found', this.found);
      storage.set('LFM_matches', this.matches);
      storage.set('LFM_settings', this.settings);
    },
    clear(){
      this.lost = []; this.found = []; this.matches = []; this.save();
    }
  };

  // ---------- Matching ----------
  function tokenize(s){ return (s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
  function jaccard(a,b){ const A=new Set(a), B=new Set(b); const inter=[...A].filter(x=>B.has(x)).length; const uni=new Set([...A,...B]).size; return uni? inter/uni : 0; }
  function dateProximity(d1, d2){ if(!d1||!d2) return 0; const diffDays = Math.abs((new Date(d1)-new Date(d2))/(1000*3600*24)); return Math.max(0, 1 - Math.min(diffDays, 30)/30); }
  function strEq(a,b){ return (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase(); }
  function scoreLostFound(lost, found){
    let score = 0;
    // Category exact match weighted
    if (strEq(lost.category, found.category)) score += 0.35;
    // Brand & color partials
    if (lost.brand && found.brand && strEq(lost.brand, found.brand)) score += 0.15;
    if (lost.color && found.color && strEq(lost.color, found.color)) score += 0.15;
    // Text similarity across title + description + marks
    const tokL = tokenize([lost.title,lost.description].join(' '));
    const tokF = tokenize([found.title,found.description].join(' '));
    score += 0.25 * jaccard(tokL, tokF);
    // Date proximity (lost vs found)
    score += 0.10 * dateProximity(lost.dateTime, found.dateTime);
    // Location overlap (naive token)
    const locSim = jaccard(tokenize(lost.location||''), tokenize(found.location||''));
    score += 0.10 * locSim;
    return Math.min(1, score);
  }

  function suggestMatchesForLost(lost){
    return DB.found.map(f=>({ type:'L2F', lostId: lost.id, foundId: f.id, score: scoreLostFound(lost,f)}))
      .sort((a,b)=>b.score-a.score).slice(0, 10);
  }
  function suggestMatchesForFound(found){
    return DB.lost.map(l=>({ type:'F2L', lostId: l.id, foundId: found.id, score: scoreLostFound(l,found)}))
      .sort((a,b)=>b.score-a.score).slice(0, 10);
  }

  // ---------- Rendering ----------
  function switchSection(id){
    $$('.section').forEach(s=>s.classList.remove('active'));
    $('#'+id).classList.add('active');
    $$('.nav-link').forEach(b=>b.classList.toggle('active', b.dataset.target===id));
  }

  function renderDashboard(){
    $('#kpiLost').textContent = DB.lost.length;
    $('#kpiFound').textContent = DB.found.length;
    $('#kpiMatched').textContent = DB.matches.length;
    const returned = DB.matches.filter(m=>m.status==='RETURNED').length;
    $('#kpiReturned').textContent = returned;

    // Category bars
    const catCounts = {};
    const allItems = [...DB.lost.map(x=>({...x,type:'LOST'})), ...DB.found.map(x=>({...x,type:'FOUND'}))];
    for(const i of allItems){ catCounts[i.category||'Uncategorized'] = (catCounts[i.category||'Uncategorized']||0)+1; }
    const maxCat = Math.max(1, ...Object.values(catCounts));
    const byCat = $('#chartByCategory'); byCat.innerHTML='';
    Object.entries(catCounts).forEach(([cat,count])=>{
      const row = document.createElement('div'); row.className='bar';
      row.innerHTML = `<div class="bar-label">${cat}</div><div class="bar-fill" style="width:${(count/maxCat)*100}%"></div><div>${count}</div>`;
      byCat.appendChild(row);
    });

    // Aging bars
    const ages = { '0-7d':0, '8-30d':0, '31-90d':0, '90d+':0 };
    const now = Date.now();
    for(const i of allItems){
      const d = i.createdAt ? new Date(i.createdAt).getTime() : now;
      const days = Math.max(0, Math.round((now - d)/86400000));
      if(days<=7) ages['0-7d']++; else if(days<=30) ages['8-30d']++; else if(days<=90) ages['31-90d']++; else ages['90d+']++;
    }
    const maxAge = Math.max(1, ...Object.values(ages));
    const aging = $('#chartAging'); aging.innerHTML='';
    Object.entries(ages).forEach(([bucket,count])=>{
      const row = document.createElement('div'); row.className='bar';
      row.innerHTML = `<div class="bar-label">${bucket}</div><div class="bar-fill" style="width:${(count/maxAge)*100}%"></div><div>${count}</div>`;
      aging.appendChild(row);
    });
  }

  function itemStatusBadges(it){
    const type = it.__type || (it.contact ? 'LOST' : 'FOUND');
    const status = it.status || 'OPEN';
    const typeClass = type==='LOST'? 'lost':'found';
    const statusClass = `status-${status.toLowerCase()}`;
    return `<span class="badge ${typeClass}">${type}</span> <span class="badge ${statusClass}">${status}</span>`;
  }

  function renderCatalog(){
    const type = $('#filterType').value;
    const status = $('#filterStatus').value;
    const category = $('#filterCategory').value;
    const q = ($('#globalSearch').value||'').toLowerCase();
    const list = $('#catalogList'); list.innerHTML='';
    const items = [
      ...DB.lost.map(x=>({ ...x, __type:'LOST'})),
      ...DB.found.map(x=>({ ...x, __type:'FOUND'}))
    ].filter(i=> type==='ALL'||i.__type===type)
     .filter(i=> status==='ALL'||(i.status||'OPEN')===status)
     .filter(i=> category==='ALL'||(i.category||'')===category)
     .filter(i=> (i.title+' '+i.category+' '+(i.color||'')+' '+(i.location||'')+' '+(i.brand||'')+' '+(i.description||'')).toLowerCase().includes(q));

    for (const it of items){
      const card = document.createElement('div'); card.className='card';
      const thumbs = (it.photos||[]).slice(0,3).map(url=>`<img src="${url}" alt="thumbnail">`).join('');
      card.innerHTML = `
        <div class="title">${it.title}</div>
        <div>${itemStatusBadges(it)}</div>
        <div class="meta">${it.category||'—'} • ${it.color||'–'} • ${it.brand||'–'}</div>
        <div class="meta">${it.location||'—'}</div>
        <div class="thumbs">${thumbs}</div>
        <div class="actions">
          <button data-act="view">View</button>
          <button data-act="suggest">Suggestions</button>
          ${ (it.__type==='FOUND' && it.status!=='RETURNED') ? '<button data-act="handover" class="primary">Handover</button>':''}
        </div>
      `;
      card.querySelector('[data-act="view"]').addEventListener('click',()=>openItemModal(it));
      card.querySelector('[data-act="suggest"]').addEventListener('click',()=>{
        switchSection('matchesSection');
        selectForMatch(it);
      });
      if (it.__type==='FOUND' && it.status!=='RETURNED'){
        card.querySelector('[data-act="handover"]').addEventListener('click',()=>handoverFlow(it));
      }
      list.appendChild(card);
    }
  }

  function openItemModal(it){
    const type = it.__type || (it.contact ? 'LOST' : 'FOUND');
    const photos = (it.photos||[]).map(u=>`<img src="${u}" alt="photo" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`).join(' ');
    const body = $('#modalBody');
    body.innerHTML = `
      <div><strong>Type:</strong> ${type}</div>
      <div><strong>Status:</strong> ${it.status||'OPEN'}</div>
      <div><strong>Title:</strong> ${it.title}</div>
      <div><strong>Category:</strong> ${it.category||'—'} | <strong>Brand:</strong> ${it.brand||'—'} | <strong>Color:</strong> ${it.color||'—'}</div>
      <div><strong>Location:</strong> ${it.location||'—'}</div>
      <div><strong>Description:</strong><br>${(it.description||'—').replace(/\n/g,'<br>')}</div>
      <div><strong>When:</strong> ${it.dateTime? fmtDate(it.dateTime):'—'}</div>
      <div><strong>Created:</strong> ${fmtDate(it.createdAt)}</div>
      ${ type==='LOST' ? `<div><strong>Contact:</strong> ${it.contact}</div>` : (it.foundBy?`<div><strong>Found By:</strong> ${it.foundBy}</div>`:'') }
      <div style="display:flex; gap:.5rem; flex-wrap:wrap;">${photos}</div>
      <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem;">
        <button id="btnShowSuggestions">Show Suggestions</button>
        ${ type==='FOUND' && it.status!=='RETURNED' ? '<button id="btnHandover" class="primary">Record Handover</button>':''}
        ${ it.status!=='DISPOSED' ? '<button id="btnDispose" class="danger">Dispose</button>':''}
      </div>
    `;
    $('#modalTitle').textContent = 'Item Details';
    const dlg = $('#itemModal');
    dlg.showModal();
    $('#btnShowSuggestions')?.addEventListener('click',()=>{ dlg.close(); switchSection('matchesSection'); selectForMatch(it); });
    $('#btnHandover')?.addEventListener('click',()=>{ dlg.close(); handoverFlow(it); });
    $('#btnDispose')?.addEventListener('click',()=>{ it.status='DISPOSED'; it.updatedAt=Date.now(); DB.save(); refreshAll(); dlg.close(); });
  }

  function handoverFlow(foundIt){
    const name = prompt('Enter claimant name'); if(!name) return;
    const idProof = prompt('Enter ID proof / last 4 digits / verification info');
    const verifier = prompt('Verifier (your name)');
    foundIt.status = 'RETURNED';
    foundIt.updatedAt = Date.now();
    foundIt.handover = { name, idProof, verifier, timestamp: Date.now() };
    DB.save();
    alert('Handover recorded.');
    refreshAll();
  }

  // ---------- Matches UI ----------
  let selectedLostId = null, selectedFoundId = null;

  function renderListsForMatch(){
    const lostWrap = $('#lostListForMatch'); lostWrap.innerHTML='';
    DB.lost.forEach(l=>{
      const row = document.createElement('div'); row.className='row';
      row.innerHTML = `<div><strong>${l.title}</strong><div class="small">${l.category||''} • ${l.color||''} • ${l.brand||''}</div></div>
        <div><button data-id="${l.id}" ${selectedLostId===l.id?'class="primary"':''}>Select</button></div>`;
      row.querySelector('button').addEventListener('click',()=>{ selectedLostId=l.id; renderListsForMatch(); renderSuggestions(); });
      lostWrap.appendChild(row);
    });

    const foundWrap = $('#foundListForMatch'); foundWrap.innerHTML='';
    DB.found.forEach(f=>{
      const row = document.createElement('div'); row.className='row';
      row.innerHTML = `<div><strong>${f.title}</strong><div class="small">${f.category||''} • ${f.color||''} • ${f.brand||''}</div></div>
        <div><button data-id="${f.id}" ${selectedFoundId===f.id?'class="primary"':''}>Select</button></div>`;
      row.querySelector('button').addEventListener('click',()=>{ selectedFoundId=f.id; renderListsForMatch(); renderSuggestions(); });
      foundWrap.appendChild(row);
    });
  }

  function renderSuggestions(){
    const wrap = $('#suggestedMatches'); wrap.innerHTML='';
    let suggestions = [];
    if(selectedLostId){ const lost = DB.lost.find(x=>x.id===selectedLostId); suggestions = suggestMatchesForLost(lost); }
    if(selectedFoundId){ const found = DB.found.find(x=>x.id===selectedFoundId); const s2 = suggestMatchesForFound(found); suggestions = suggestions.length? intersectSuggestions(suggestions,s2) : s2; }

    if(!suggestions.length){ wrap.innerHTML = '<div class="small">Select at least one item to see suggestions.</div>'; return; }

    for(const s of suggestions){
      const lost = DB.lost.find(x=>x.id===s.lostId);
      const found = DB.found.find(x=>x.id===s.foundId);
      const row = document.createElement('div'); row.className='row';
      const pct = Math.round(s.score*100);
      row.innerHTML = `
        <div>
          <div><strong>Lost:</strong> ${lost?.title||'—'} <span class="small">(${lost?.category||''} • ${lost?.color||''})</span></div>
          <div><strong>Found:</strong> ${found?.title||'—'} <span class="small">(${found?.category||''} • ${found?.color||''})</span></div>
        </div>
        <div style="display:flex; align-items:center; gap:.5rem">
          <div class="badge">Confidence: ${pct}%</div>
          <button class="primary" data-act="confirm">Confirm Match</button>
        </div>
      `;
      row.querySelector('[data-act="confirm"]').addEventListener('click',()=>{
        confirmMatch(lost, found, s.score);
      });
      wrap.appendChild(row);
    }
  }

  function intersectSuggestions(a,b){
    // Keep pairs that appear in both lists, average the score
    const map = new Map();
    for(const s of a){ map.set(s.lostId+'|'+s.foundId, s); }
    const out = [];
    for(const t of b){ const k=t.lostId+'|'+t.foundId; if(map.has(k)){ out.push({ ...t, score: (t.score+map.get(k).score)/2 }) } }
    return out.sort((x,y)=>y.score-x.score).slice(0,10);
  }

  function confirmMatch(lost, found, score){
    // Create a match record
    const m = { id:id(), lostId:lost.id, foundId:found.id, score, status:'MATCHED', createdAt: Date.now() };
    DB.matches.push(m);
    // Mark items as matched (not returned yet)
    lost.status = 'MATCHED'; lost.updatedAt = Date.now();
    found.status = 'MATCHED'; found.updatedAt = Date.now();
    DB.save();
    alert('Match confirmed. Proceed to handover when claimant verified.');
    refreshAll();
  }

  // ---------- Forms ----------
  function readPhotos(files){
    if(!files || !files.length) return Promise.resolve([]);
    return Promise.all(Array.from(files).slice(0,5).map(f=>new Promise(res=>{
      const fr = new FileReader(); fr.onload = ()=>res(fr.result); fr.readAsDataURL(f);
    })));
  }

  $('#lostForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const photos = await readPhotos(fd.getAll('photos'));
    const item = {
      id: id(), title: fd.get('title'), category: fd.get('category'), brand: fd.get('brand'), color: fd.get('color'),
      description: fd.get('description'), dateTime: fd.get('dateTime'), location: fd.get('location'), contact: fd.get('contact'),
      photos, status:'OPEN', createdAt: Date.now(), updatedAt: Date.now()
    };
    DB.lost.push(item); DB.save();
    e.target.reset();
    alert('Lost report submitted.');
    switchSection('catalogSection');
    refreshAll();
  });

  $('#foundForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const photos = await readPhotos(fd.getAll('photos'));
    const item = {
      id: id(), title: fd.get('title'), category: fd.get('category'), brand: fd.get('brand'), color: fd.get('color'),
      description: fd.get('description'), dateTime: fd.get('dateTime'), location: fd.get('location'), foundBy: fd.get('foundBy')||'',
      photos, status:'OPEN', createdAt: Date.now(), updatedAt: Date.now()
    };
    DB.found.push(item); DB.save();
    e.target.reset();
    alert('Found item recorded.');
    switchSection('catalogSection');
    refreshAll();
  });

  // ---------- Global Search & Filters ----------
  $('#globalSearch').addEventListener('input', renderCatalog);
  $('#filterType').addEventListener('change', renderCatalog);
  $('#filterStatus').addEventListener('change', renderCatalog);
  $('#filterCategory').addEventListener('change', renderCatalog);

  // ---------- Navigation ----------
  $$('.nav-link').forEach(b=> b.addEventListener('click', ()=> switchSection(b.dataset.target)) );

  // ---------- Export / Import ----------
  $('#btnExport').addEventListener('click', ()=>{
    const payload = { lost: DB.lost, found: DB.found, matches: DB.matches, settings: DB.settings, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lost-found-data.json'; a.click(); URL.revokeObjectURL(a.href);
  });

  $('#importFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return; const txt = await file.text();
    try{
      const data = JSON.parse(txt);
      if(confirm('Import will replace current data. Continue?')){
        DB.lost = data.lost||[]; DB.found = data.found||[]; DB.matches = data.matches||[]; DB.settings = data.settings||DB.settings; DB.save(); refreshAll();
        alert('Import complete.');
      }
    }catch(err){ alert('Invalid JSON: '+err.message); }
    e.target.value='';
  });

  // ---------- Settings ----------
  $('#retentionDays').addEventListener('change', (e)=>{ DB.settings.retentionDays = Number(e.target.value||120); DB.save(); });
  $('#btnPurge').addEventListener('click', ()=>{
    const days = DB.settings.retentionDays||120; const cutoff = Date.now() - days*86400000;
    const beforeL = DB.lost.length, beforeF = DB.found.length;
    DB.lost = DB.lost.filter(x=> (x.status==='RETURNED') || (x.createdAt > cutoff));
    DB.found = DB.found.filter(x=> (x.status==='RETURNED') || (x.createdAt > cutoff));
    DB.matches = DB.matches.filter(m=> DB.lost.some(l=>l.id===m.lostId) && DB.found.some(f=>f.id===m.foundId));
    DB.save();
    alert(`Purged ${beforeL-DB.lost.length + beforeF-DB.found.length} items older than ${days} days.`);
    refreshAll();
  });

  $('#btnSeed').addEventListener('click', ()=>{
    if(!confirm('Load sample data? This adds to existing records.')) return;
    const now = Date.now();
    const lost = [
      {title:'Black iPhone 12', category:'Mobile Phone', brand:'Apple', color:'Black', description:'Matte black case with sticker', dateTime:new Date(now-3*86400000).toISOString(), location:'Library 2nd floor', contact:'user1@example.com'},
      {title:'Brown Leather Wallet', category:'Wallet', brand:'WildHorn', color:'Brown', description:'Contains college ID and 2 cards', dateTime:new Date(now-2*86400000).toISOString(), location:'Cafeteria', contact:'user2@example.com'},
      {title:'Blue Backpack', category:'Bag', brand:'Skybags', color:'Blue', description:'Front pocket zip broken', dateTime:new Date(now-7*86400000).toISOString(), location:'Main Gate', contact:'user3@example.com'}
    ].map(x=>({ id:id(), ...x, photos:[], status:'OPEN', createdAt: now- (Math.random()*9*86400000), updatedAt: now }));

    const found = [
      {title:'Black iPhone 12', category:'Mobile Phone', brand:'Apple', color:'Black', description:'Found near Library computers', dateTime:new Date(now-2*86400000).toISOString(), location:'Library', foundBy:'Security Desk'},
      {title:'Leather Wallet', category:'Wallet', brand:'—', color:'Brown', description:'Cashless. Found at cafeteria corner', dateTime:new Date(now-1*86400000).toISOString(), location:'Cafeteria', foundBy:'Student Affairs'},
      {title:'Backpack', category:'Bag', brand:'—', color:'Blue', description:'Blue bag with broken front zip', dateTime:new Date(now-6*86400000).toISOString(), location:'Main Gate', foundBy:'Security'}
    ].map(x=>({ id:id(), ...x, photos:[], status:'OPEN', createdAt: now- (Math.random()*9*86400000), updatedAt: now }));

    DB.lost.push(...lost); DB.found.push(...found); DB.save(); refreshAll(); alert('Sample data loaded.');
  });

  $('#btnClear').addEventListener('click', ()=>{ if(confirm('Clear ALL data?')){ DB.clear(); refreshAll(); }});

  // ---------- Match selection helper ----------
  function selectForMatch(it){
    if(it.__type==='LOST' || it.contact){ selectedLostId = it.id; }
    else selectedFoundId = it.id;
    renderListsForMatch(); renderSuggestions();
  }

  // ---------- Global Refresh ----------
  function refreshAll(){
    renderDashboard();
    renderCatalog();
    renderListsForMatch();
    renderSuggestions();
  }

  // ---------- Init ----------
  function init(){
    DB.load();
    document.getElementById('year').textContent = new Date().getFullYear();
    $('#retentionDays').value = DB.settings.retentionDays||120;
    refreshAll();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
