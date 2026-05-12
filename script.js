// === CONSTANTS ===
const CIRC = 2 * Math.PI * 85; // r=85 → 534.07

// Default pomodoro settings (overridden by saved settings)
let pomoSettings = {
  work:      25 * 60,
  short:     5  * 60,
  long:      15 * 60,
  cycle:     4,
  autoAdv:   true,
  skipBreaks: [],
  customPlan: null   // null = auto-generate from cycle/breaks; array of type strings = custom order
};

let pomoLog = [];
let pomoLogDate = new Date().toDateString();
let pomoGoalTarget = 8; // daily work session target

const POMO_STROKE = { work: '#fb4934', short: '#b8bb26', long: '#83a598' };
const PROJ_COLORS = ['#458588','#b16286','#689d6a','#d79921','#cc241d','#98971a'];

// === STATE ===
let mode = 'work', pomoSec = pomoSettings.work, pomoTotal = pomoSettings.work;
let pomoRunning = false, pomoInterval = null, sessionsD = 0;
let planIdx = 0, planDrag = null; // planDrag: active pointer drag state
let taskRunning = false, taskStart = null, taskInterval = null, activeEntry = null;
let timeEntries = [], goals = [], projects = [], viewDate = new Date();
let calViewDate = new Date(); // separate calendar navigation

// === DOM ===
const $ = id => document.getElementById(id);
const ringFg = $('ringFg');
const pomoDisp = $('pomoDisplay');
const pomoSub = $('pomoSub');
const pomoStartBtn = $('pomoStart');
const entryList = $('entryList');
const goalList = $('goalList');
const projList = $('projList');
const taskInput = $('taskInput');
const projSelect = $('projSelect');
const trackBtn = $('trackBtn');
const liveTimer = $('liveTimer');

// === UTILS ===
const fmt = ms => {
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return [h,m,sec].map(u=>String(u).padStart(2,'0')).join(':');
};
const fmtMS = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2);
const sameDay = (a,b) => a.toDateString()===b.toDateString();
const sowk = d => { const r=new Date(d),dy=r.getDay(); r.setDate(r.getDate()-dy+(dy===0?-6:1)); r.setHours(0,0,0,0); return r; };
const sameWeek = (a,b) => sameDay(sowk(a),sowk(b));
const sameMon = (a,b) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth();
const sanitize = (el,max) => { el.value=el.value.replace(/\D/g,''); if(max!=null&&parseInt(el.value)>max) el.value=max; };
const projColor = id => { const i=projects.findIndex(p=>p.id===id); return i>=0?PROJ_COLORS[i%PROJ_COLORS.length]:'#665c54'; };
const parseDateLocal = str => { if(!str) return null; const [y,mo,d]=str.split('-').map(Number); const dt=new Date(y,mo-1,d); dt.setHours(0,0,0,0); return dt; };

// Human-readable duration, e.g. "1h 25m"
const fmtHuman = secs => {
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${s>0?s+'s':''}`.trim();
  return `${s}s`;
};

// === TOAST ===
const toast = (msg,type='ok') => {
  const t=document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg;
  $('toastContainer').appendChild(t);
  setTimeout(()=>{ t.style.animation='tout .18s ease forwards'; t.addEventListener('animationend',()=>t.remove()); },2800);
};

// === MODAL ===
const openM = id => {
  $(id).classList.add('open');
  requestAnimationFrame(()=>{
    const el=$(id).querySelector('input,select,button:not(.mcls)');
    if(el) el.focus();
  });
};
const closeM = id => $(id).classList.remove('open');
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeM(b.dataset.close)));
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{
  if(e.target===o && !o.hasAttribute('data-no-overlay-close')) o.classList.remove('open');
}));
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') {
    const open=[...document.querySelectorAll('.overlay.open')];
    if(open.length){ const last=open[open.length-1]; if(!last.hasAttribute('data-no-overlay-close')) last.classList.remove('open'); }
  }
});

// === ALERT ===
let alertCb=null;
const alert2 = (msg,isConfirm=false,cb=null) => {
  $('alertMsg').textContent=msg;
  $('alertCancel').style.display=isConfirm?'':'none';
  $('alertOk').textContent=isConfirm?'CONFIRM':'OK';
  alertCb=cb; openM('alertModal');
  requestAnimationFrame(()=>(isConfirm?$('alertCancel'):$('alertOk')).focus());
};
$('alertOk').onclick=()=>{ closeM('alertModal'); if(alertCb) alertCb(true); };
$('alertCancel').onclick=()=>{ closeM('alertModal'); if(alertCb) alertCb(false); };

// === SOUND ===
const playBell = () => {
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine'; osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440,ctx.currentTime+0.4);
    gain.gain.setValueAtTime(0.3,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.8);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.8);
    setTimeout(()=>ctx.close(),1000);
  } catch(e){}
};

// === STORAGE ===
const save = () => {
  try {
    localStorage.setItem('tt_e',JSON.stringify(timeEntries));
    localStorage.setItem('tt_g',JSON.stringify(goals));
    localStorage.setItem('tt_p',JSON.stringify(projects));
    localStorage.setItem('tt_ps',JSON.stringify(pomoSettings));
    localStorage.setItem('tt_pl',JSON.stringify({log:pomoLog,date:pomoLogDate}));
    localStorage.setItem('tt_pg',String(pomoGoalTarget));
    if(activeEntry) localStorage.setItem('tt_a',JSON.stringify({...activeEntry,startTime:taskStart.toISOString()}));
    else localStorage.removeItem('tt_a');
  } catch(e){ toast('Save failed','err'); }
};
const load = () => {
  try {
    timeEntries=JSON.parse(localStorage.getItem('tt_e'))||[];
    goals=JSON.parse(localStorage.getItem('tt_g'))||[];
    projects=JSON.parse(localStorage.getItem('tt_p'))||[];
    const ps=JSON.parse(localStorage.getItem('tt_ps'));
    if(ps) Object.assign(pomoSettings,ps);
    const plRaw=JSON.parse(localStorage.getItem('tt_pl'));
    if(plRaw){
      if(plRaw.date===new Date().toDateString()){ pomoLog=plRaw.log||[]; pomoLogDate=plRaw.date; }
      else { pomoLog=[]; pomoLogDate=new Date().toDateString(); }
    }
    const pg=localStorage.getItem('tt_pg');
    if(pg) pomoGoalTarget=parseInt(pg)||8;
    const a=JSON.parse(localStorage.getItem('tt_a'));
    if(a){
      taskStart=new Date(a.startTime);
      activeEntry={id:a.id,task:a.task,projectId:a.projectId,projectName:a.projectName};
      taskRunning=true; taskInput.value=a.task; projSelect.value=a.projectId||'';
      startLive();
      taskInput.readOnly=true; projSelect.disabled=true;
      trackBtn.innerHTML='<i class="fas fa-stop" aria-hidden="true"></i> STOP';
      trackBtn.classList.add('on'); trackBtn.setAttribute('aria-label','Stop task timer');
      liveTimer.classList.remove('off');
    }
  } catch(e){ toast('Load failed','err'); }
};

// === POMODORO ===
const updateRing = () => {
  const ratio=pomoSec/pomoTotal, offset=CIRC*(1-ratio);
  ringFg.style.strokeDashoffset=offset; ringFg.style.stroke=POMO_STROKE[mode];
};

const updateDots = () => {
  const container=$('pomoDots');
  container.innerHTML='';
  const cycle=pomoSettings.cycle||4;
  const isBreak=(mode==='short'||mode==='long');
  for(let i=0;i<cycle;i++){
    const d=document.createElement('div'); d.className='dot';
    const sessionIdx=sessionsD%cycle;
    if(i<sessionIdx){ d.classList.add('done'); d.setAttribute('aria-label',`Session ${i+1}: complete`); }
    else if(i===sessionIdx){
      if(isBreak){ d.classList.add('break'); d.setAttribute('aria-label',`Session ${i+1}: break`); }
      else { d.classList.add('cur'); d.setAttribute('aria-label',`Session ${i+1}: current`); }
    } else { d.setAttribute('aria-label',`Session ${i+1}`); }
    container.appendChild(d);
  }
};

// Helper: should break at slot (1-based) be shown/taken?
const breakEnabled = slot => !(pomoSettings.skipBreaks||[]).includes(slot);

// === CUSTOM PLAN ===
const getPlanTypes = () => {
  if (pomoSettings.customPlan && pomoSettings.customPlan.length > 0)
    return [...pomoSettings.customPlan];
  const cycle = pomoSettings.cycle || 4;
  const types = [];
  for (let i = 0; i < cycle; i++) {
    types.push('work');
    const slot = i + 1;
    if (breakEnabled(slot)) types.push('short');
  }
  return types;
};
const planSecFor = t => t === 'work' ? pomoSettings.work : t === 'short' ? pomoSettings.short : pomoSettings.long;
const isCustomPlan = () => !!(pomoSettings.customPlan && pomoSettings.customPlan.length > 0);
const initCustomPlan = () => { if (!isCustomPlan()) pomoSettings.customPlan = getPlanTypes(); };

// Write all derived values back to pomoSettings so settings modal is fully in sync
const syncSettingsFromPlan = () => {
  const plan = pomoSettings.customPlan;
  if (!plan || !plan.length) return;
  const workCount = plan.filter(t => t === 'work').length;
  if (workCount > 0) pomoSettings.cycle = workCount;
  // skipBreaks: not derivable from a free-form plan — left unchanged
};

// Only rule: plan must contain at least one work block
const isPlanValid = plan => !!(plan && plan.includes('work'));

const cycleBlockType = idx => {
  initCustomPlan();
  const order = ['work','short','long'];
  const original = pomoSettings.customPlan[idx];
  let next = original;
  for (let i = 0; i < order.length; i++) {
    next = order[(order.indexOf(next) + 1) % order.length];
    const trial = [...pomoSettings.customPlan]; trial[idx] = next;
    if (isPlanValid(trial)) { pomoSettings.customPlan[idx] = next; break; }
  }
  if (pomoSettings.customPlan[idx] === original) { toast('Need at least one work block — add more first'); return; }
  syncSettingsFromPlan(); save(); renderPlanStrip();
};
const removeBlock = idx => {
  initCustomPlan();
  if (pomoSettings.customPlan.length <= 1) return;
  const trial = [...pomoSettings.customPlan]; trial.splice(idx, 1);
  if (!isPlanValid(trial)) { toast('Need at least one work block in the session'); return; }
  pomoSettings.customPlan.splice(idx, 1);
  if (planIdx >= pomoSettings.customPlan.length) planIdx = 0;
  syncSettingsFromPlan(); save(); renderPlanStrip();
};
const addBlock = (type = 'short') => {
  initCustomPlan();
  // Only rule: plan must contain at least one work block. Adding any type is fine.
  pomoSettings.customPlan.push(type);
  syncSettingsFromPlan(); save(); renderPlanStrip();
};
const resetPlan = () => { pomoSettings.customPlan = null; planIdx = 0; save(); renderPlanStrip(); toast('Plan reset to auto'); };

const advancePlan = (autostart = false) => {
  const types = getPlanTypes();
  if (!types.length) return;
  planIdx = (planIdx + 1) % types.length;
  if (types[planIdx] === 'work') sessionsD++;
  renderPlanStrip(); updateDots();
  setMode(types[planIdx], autostart);
};

const renderPlanStrip = () => {
  const container = $('pomoPlan');
  container.innerHTML = '';
  if (!pomoSettings.autoAdv) return;

  const types = getPlanTypes();
  const totalSec = types.reduce((s, t) => s + planSecFor(t), 0);
  const custom = isCustomPlan();
  const blockEls = [];

  // Insertion line (hidden until drag starts)
  const insertLine = document.createElement('div');
  insertLine.className = 'plan-insert-line';
  insertLine.style.display = 'none';
  container.appendChild(insertLine);

  // Render blocks
  types.forEach((type, idx) => {
    const block = document.createElement('div');
    block.className = `plan-block ${type}${idx === planIdx ? ' plan-cur' : ''}`;
    block.title = `${type === 'work' ? 'Work' : type === 'short' ? 'Short break' : 'Long break'} · click to change`;
    block.textContent = fmtHuman(planSecFor(type));
    block.dataset.idx = idx;

    const del = document.createElement('button');
    del.className = 'pb-del'; del.textContent = '×'; del.title = 'Remove';
    del.setAttribute('tabindex', '-1');
    del.addEventListener('click', e => { e.stopPropagation(); removeBlock(idx); });
    block.appendChild(del);

    // Click to cycle (only if not dragging)
    block.addEventListener('click', e => {
      if (planDrag) return;
      if (!e.target.classList.contains('pb-del')) cycleBlockType(idx);
    });

    // Pointer drag
    block.addEventListener('pointerdown', e => {
      if (e.target.classList.contains('pb-del') || e.button !== 0) return;
      e.preventDefault();
      block.setPointerCapture(e.pointerId);

      const rect = block.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = `plan-ghost ${type}`;
      ghost.textContent = fmtHuman(planSecFor(type));
      ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;`;
      document.body.appendChild(ghost);

      // Snapshot natural (unshifted) rects once — used every frame for stable detection
      const naturalRects = blockEls.map(b => b.getBoundingClientRect());

      planDrag = {
        srcIdx: idx,
        insertIdx: idx,
        ghost,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        moved: false,
        naturalRects
      };

      block.classList.add('dragging');
      insertLine.style.display = '';
    });

    block.addEventListener('pointermove', e => {
      if (!planDrag || planDrag.srcIdx !== idx) return;
      planDrag.moved = true;
      const { ghost, offsetX, offsetY, naturalRects } = planDrag;
      const srcIdx = planDrag.srcIdx;

      // Move ghost
      const gx = e.clientX - offsetX, gy = e.clientY - offsetY;
      ghost.style.left = gx + 'px';
      ghost.style.top = gy + 'px';
      ghost.style.transform = `rotate(${(e.clientX - (gx + ghost.offsetWidth / 2)) * 0.02}deg) scale(1.08)`;

      // ── 1. Detect insertIdx from natural (unshifted) midpoints ──────────────
      // Natural rects are frozen from pointerdown so this is stable every frame,
      // regardless of how far CSS transitions have animated blocks since last frame.
      let insertIdx = types.length;
      for (let i = 0; i < blockEls.length; i++) {
        if (i === srcIdx) continue;
        const r = naturalRects[i];
        if (e.clientX < r.left + r.width / 2) { insertIdx = i; break; }
      }
      planDrag.insertIdx = insertIdx;

      // ── 2. Shift non-source blocks to open a gap ────────────────────────────
      // logicalInsertIdx: insertIdx translated to without-source space so the
      // logicalI comparison is in the same index space.
      const logicalInsertIdx = insertIdx > srcIdx ? insertIdx - 1 : insertIdx;
      const gapW = naturalRects[srcIdx].width + 4;
      blockEls.forEach((b, i) => {
        if (i === srcIdx) return;
        b.classList.add('shifting');
        const logicalI = i < srcIdx ? i : i - 1;
        b.style.transform = `translateX(${logicalI >= logicalInsertIdx ? gapW : 0}px)`;
      });

      // ── 3. Position insert line from natural rects + shift offsets ──────────
      // No DOM read here — we compute exact visual positions analytically so the
      // line never lags or jumps due to in-flight CSS transitions.
      const containerRect = container.getBoundingClientRect();
      let lineX;
      if (logicalInsertIdx === 0) {
        // Before all non-source blocks: left edge of the first one (all shifted right)
        const firstNonSrc = naturalRects.findIndex((_, i) => i !== srcIdx);
        lineX = firstNonSrc >= 0 ? naturalRects[firstNonSrc].left - containerRect.left - 4 : 4;
      } else {
        // After the (logicalInsertIdx-1)-th non-source block in without-source order.
        // Find its full-array index by iterating non-source blocks.
        let count = 0, beforeFullIdx = -1;
        for (let i = 0; i < blockEls.length; i++) {
          if (i === srcIdx) continue;
          if (count === logicalInsertIdx - 1) { beforeFullIdx = i; break; }
          count++;
        }
        lineX = beforeFullIdx >= 0
          ? naturalRects[beforeFullIdx].right - containerRect.left + 3
          : naturalRects[naturalRects.length - 1].right - containerRect.left + 3;
      }
      insertLine.style.left = Math.max(0, lineX) + 'px';
    });

    const endDrag = e => {
      if (!planDrag || planDrag.srcIdx !== idx) return;
      const { srcIdx, insertIdx, ghost, moved } = planDrag;

      ghost.remove();
      insertLine.style.display = 'none';
      blockEls.forEach(b => { b.style.transform = ''; b.classList.remove('shifting','dragging'); });
      planDrag = null;

      if (!moved) return; // treat as click — cycleBlockType handles it

      // Commit reorder
      if (srcIdx !== insertIdx && srcIdx !== insertIdx - 1) {
        initCustomPlan();
        const plan = pomoSettings.customPlan;
        const [item] = plan.splice(srcIdx, 1);
        const adj = insertIdx > srcIdx ? insertIdx - 1 : insertIdx;
        const trial = [...plan]; trial.splice(adj, 0, item);
        if (isPlanValid(trial)) {
          plan.splice(adj, 0, item);
          if (planIdx === srcIdx) planIdx = adj;
          syncSettingsFromPlan(); save();
        } else {
          plan.splice(srcIdx, 0, item); // put back
          toast("Must keep at least one work block");
        }
      }
      renderPlanStrip();
      // If settings modal is open, keep it in sync with drag results
      if ($('pomoSettingsModal').classList.contains('open')) {
        const workCount = (pomoSettings.customPlan || []).filter(t => t === 'work').length;
        $('psCycle').value = Math.max(1, workCount);
        renderBreakSlots();
        updateSettingsPreview();
      }
    };

    block.addEventListener('pointerup', endDrag);
    block.addEventListener('pointercancel', endDrag);

    container.appendChild(block);
    blockEls.push(block);
  });

  // + add button with type dropdown
  const addWrap = document.createElement('div');
  addWrap.className = 'plan-add-wrap';
  const addBtn = document.createElement('button');
  addBtn.className = 'plan-add-btn'; addBtn.title = 'Add block'; addBtn.textContent = '+';
  addBtn.setAttribute('aria-label', 'Add block');
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    const existing = addWrap.querySelector('.plan-add-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'plan-add-menu';
    [['WORK', 'work'], ['SHORT', 'short'], ['LONG', 'long']].forEach(([label, type]) => {
      const item = document.createElement('button');
      item.className = `plan-add-menu-item ${type}`;
      item.textContent = label;
      item.addEventListener('click', ev => { ev.stopPropagation(); menu.remove(); addBlock(type); });
      menu.appendChild(item);
    });
    addWrap.appendChild(menu);
    setTimeout(() => {
      const close = ev => { if (!addWrap.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  });
  addWrap.appendChild(addBtn);
  container.appendChild(addWrap);

  // Total
  const tot = document.createElement('span');
  tot.className = 'plan-total'; tot.textContent = `= ${fmtHuman(totalSec)} total`;
  container.appendChild(tot);

  // Reset (only when customised)
  if (custom) {
    const rst = document.createElement('button');
    rst.className = 'plan-reset'; rst.textContent = '↺'; rst.title = 'Reset to auto';
    rst.addEventListener('click', resetPlan);
    container.appendChild(rst);
  }
};

const updateAutoBadge = () => {
  const badge = $('autoBadge');
  badge.textContent = pomoSettings.autoAdv ? 'AUTO ▶' : 'MANUAL';
  badge.className = 'auto-badge' + (pomoSettings.autoAdv ? '' : ' off');
};

$('autoBadge').addEventListener('click', () => {
  pomoSettings.autoAdv = !pomoSettings.autoAdv;
  updateAutoBadge();
  renderPlanStrip();
  save();
  toast(pomoSettings.autoAdv ? 'Auto-advance ON' : 'Manual mode ON');
});

const setMode = (m, autostart=false) => {
  mode=m;
  pomoSec=(m==='work'?pomoSettings.work:m==='short'?pomoSettings.short:pomoSettings.long);
  pomoTotal=pomoSec;
  if(!autostart){
    pomoRunning=false;
    clearInterval(pomoInterval);
    pomoStartBtn.innerHTML='<i class="fas fa-play" aria-hidden="true"></i>';
    pomoStartBtn.setAttribute('aria-label','Start timer');
    pomoStartBtn.classList.remove('run');
  }
  document.querySelectorAll('.pomo-tab').forEach(b=>{
    const active=b.dataset.m===m;
    b.classList.toggle('active',active);
    b.setAttribute('aria-selected',active);
  });
  pomoDisp.textContent=fmtMS(pomoSec);
  updateRing(); updateDots();
  const cycle=pomoSettings.cycle||4;
  if(m==='work') pomoSub.textContent=`SESSION ${(sessionsD%cycle)+1} OF ${cycle}`;
  else if(m==='short') pomoSub.textContent=`SHORT BREAK · ${sessionsD} DONE`;
  else pomoSub.textContent=`LONG BREAK · ${sessionsD} DONE`;
  document.title=`${fmtMS(pomoSec)} — FOCUS`;
  if(autostart){ startPomoInterval(); }
};

const startPomoInterval = () => {
  clearInterval(pomoInterval);
  pomoRunning=true;
  pomoStartBtn.innerHTML='<i class="fas fa-pause" aria-hidden="true"></i>';
  pomoStartBtn.setAttribute('aria-label','Pause timer');
  pomoStartBtn.classList.add('run');
  pomoInterval=setInterval(tickPomo,1000);
};

const tickPomo = () => {
  pomoSec--;
  pomoDisp.textContent=fmtMS(pomoSec);
  updateRing();
  document.title=`${fmtMS(pomoSec)} — FOCUS`;
  if(pomoSec<=0){
    clearInterval(pomoInterval); pomoRunning=false;
    pomoStartBtn.innerHTML='<i class="fas fa-play" aria-hidden="true"></i>';
    pomoStartBtn.setAttribute('aria-label','Start timer');
    pomoStartBtn.classList.remove('run');
    playBell();
    // Log the completed session
    logPomoSession(mode, pomoTotal);
    if (mode === 'work') {
      if (Notification.permission === 'granted') new Notification('FOCUS – Session complete!', { body: 'Take a break.' });
      toast(`Session complete! Take a break.`, 'ok');
    } else {
      if (Notification.permission === 'granted') new Notification('FOCUS – Break over!', { body: 'Time to focus.' });
      toast('Break over! Time to focus.', 'ok');
    }
    if (pomoSettings.autoAdv) {
      setTimeout(() => advancePlan(true), 800);
    } else {
      advancePlan(false);
    }
  }
};

pomoStartBtn.addEventListener('click',()=>{
  if(pomoRunning){
    clearInterval(pomoInterval); pomoRunning=false;
    pomoStartBtn.innerHTML='<i class="fas fa-play" aria-hidden="true"></i>';
    pomoStartBtn.setAttribute('aria-label','Start timer');
    pomoStartBtn.classList.remove('run');
  } else {
    if(Notification.permission==='default') Notification.requestPermission();
    startPomoInterval();
  }
});
$('pomoReset').addEventListener('click',()=>{ clearInterval(pomoInterval); pomoRunning=false; setMode(mode); });

// === CLICK-TO-EDIT MAIN TIMER ===
const pomoInput = $('pomoTimeInput');

const enterTimerEdit = () => {
  if (pomoRunning) return; // only when paused/stopped
  pomoDisp.classList.add('editing');
  pomoInput.classList.add('editing');
  pomoInput.value = fmtMS(pomoSec);
  pomoInput.select();
};

const commitTimerEdit = () => {
  const raw = pomoInput.value.trim();
  const match = raw.match(/^(\d{1,2}):?(\d{2})$/) || raw.match(/^(\d+)$/);
  if (match) {
    let mins, secs;
    if (match[2] !== undefined) { mins = parseInt(match[1]); secs = parseInt(match[2]); }
    else { mins = parseInt(match[1]); secs = 0; }
    const total = Math.max(1, mins * 60 + Math.min(secs, 59));
    pomoSec = total; pomoTotal = total;
  }
  pomoDisp.classList.remove('editing');
  pomoInput.classList.remove('editing');
  pomoDisp.textContent = fmtMS(pomoSec);
  updateRing();
  document.title = `${fmtMS(pomoSec)} — FOCUS`;
};

pomoDisp.addEventListener('click', enterTimerEdit);
pomoInput.addEventListener('blur', commitTimerEdit);
pomoInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitTimerEdit(); }
  if (e.key === 'Escape') {
    pomoDisp.classList.remove('editing');
    pomoInput.classList.remove('editing');
  }
});
$('pomoSkip').addEventListener('click', () => {
  clearInterval(pomoInterval); pomoRunning = false;
  if (mode === 'work') { logPomoSession(mode, pomoTotal - pomoSec); }
  advancePlan(false);
});
document.querySelectorAll('.pomo-tab').forEach(b=>b.addEventListener('click',()=>{
  if(pomoRunning){ clearInterval(pomoInterval); pomoRunning=false; pomoStartBtn.innerHTML='<i class="fas fa-play" aria-hidden="true"></i>'; pomoStartBtn.classList.remove('run'); }
  const m = b.dataset.m;
  // Snap planIdx to first matching block in plan
  const types = getPlanTypes();
  const found = types.findIndex((t, i) => t === m && i >= planIdx);
  if (found !== -1) planIdx = found;
  else { const first = types.findIndex(t => t === m); if (first !== -1) planIdx = first; }
  setMode(m); renderPlanStrip();
}));

// === POMODORO SETTINGS ===
// Immediately commit break slot UI state → customPlan → plan strip (live sync)
const applySlotsToPlan = () => {
  const cy = parseInt($('psCycle').value) || 4;
  const slots = $('psBreakSlots').querySelectorAll('.break-slot');
  const newPlan = [];
  for (let i = 0; i < cy; i++) {
    newPlan.push('work');
    if (i < slots.length) {
      const cb      = slots[i].querySelector('input[type=checkbox]');
      const typeBtn = slots[i].querySelector('.bs-type-btn');
      if (cb && cb.checked) newPlan.push(typeBtn ? typeBtn.dataset.type : 'short');
    }
  }
  pomoSettings.customPlan = newPlan;
  syncSettingsFromPlan();
  save();
  updateSettingsPreview(); // this will renderPlanStrip internally
};

const renderBreakSlots = () => {
  const cy = parseInt($('psCycle').value) || 4;
  const container = $('psBreakSlots');

  // Preserve user-edited states from already-rendered slots before clearing
  const existingStates = {};
  container.querySelectorAll('.break-slot').forEach((slot, i) => {
    const cb  = slot.querySelector('input[type=checkbox]');
    const btn = slot.querySelector('.bs-type-btn');
    existingStates[i] = {
      enabled: cb  ? cb.checked          : true,
      type:    btn ? btn.dataset.type : 'short'
    };
  });

  container.innerHTML = '';

  for (let i = 0; i < cy; i++) {
    let breakType = 'short';
    let enabled   = true;

    if (i in existingStates) {
      // Keep whatever the user already set in this session
      breakType = existingStates[i].type;
      enabled   = existingStates[i].enabled;
    } else if (isCustomPlan()) {
      // Derive from the live customPlan: find the break (if any) after the i-th work block
      const plan = pomoSettings.customPlan;
      let workCount = 0;
      let found = false;
      for (let j = 0; j < plan.length; j++) {
        if (plan[j] === 'work') {
          workCount++;
          if (workCount === i + 1) {
            if (j + 1 < plan.length && (plan[j+1] === 'short' || plan[j+1] === 'long')) {
              breakType = plan[j+1];
              enabled   = true;
            } else {
              enabled = false;
            }
            found = true;
            break;
          }
        }
      }
      if (!found) { enabled = false; }
    } else {
      // Simple model: derive from skipBreaks array
      const skip = pomoSettings.skipBreaks || [];
      enabled = !skip.includes(i + 1);
    }

    const slot = document.createElement('div');
    slot.className = 'break-slot' + (enabled ? '' : ' skipped');

    const label = document.createElement('div');
    label.className = 'break-slot-label';
    label.innerHTML = `Break after <b>Session ${i + 1}</b>`;

    const controls = document.createElement('div');
    controls.className = 'break-slot-controls';

    // SHORT / LONG toggle button — also shows the duration
    const typeBtn = document.createElement('button');
    const getDurLabel = t => fmtHuman(t === 'short' ? pomoSettings.short : pomoSettings.long);
    typeBtn.className = `bs-type-btn ${breakType}`;
    typeBtn.textContent = (breakType === 'long' ? 'LONG' : 'SHORT') + ' · ' + getDurLabel(breakType);
    typeBtn.dataset.type = breakType;
    typeBtn.title = 'Click to toggle SHORT / LONG break';
    typeBtn.disabled = !enabled;
    typeBtn.addEventListener('click', () => {
      const newType = typeBtn.dataset.type === 'short' ? 'long' : 'short';
      typeBtn.dataset.type = newType;
      typeBtn.textContent = (newType === 'long' ? 'LONG' : 'SHORT') + ' · ' + getDurLabel(newType);
      typeBtn.className = `bs-type-btn ${newType}`;
      applySlotsToPlan();
    });

    // Enabled checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled;
    cb.dataset.slot = String(i + 1);
    cb.title = 'Include this break';
    cb.addEventListener('change', () => {
      const isNowEnabled = cb.checked;
      typeBtn.disabled = !isNowEnabled;
      slot.classList.toggle('skipped', !isNowEnabled);
      applySlotsToPlan();
    });

    controls.appendChild(typeBtn);
    controls.appendChild(cb);

    slot.appendChild(label);
    slot.appendChild(controls);
    container.appendChild(slot);
  }
};

// Snapshot of settings before modal is opened — used to restore on Cancel
let _origPomoSettings = null;

$('pomoSettingsBtn').addEventListener('click', () => {
  // Save snapshot for Cancel
  _origPomoSettings = {
    work: pomoSettings.work, short: pomoSettings.short, long: pomoSettings.long,
    cycle: pomoSettings.cycle, autoAdv: pomoSettings.autoAdv,
    customPlan: pomoSettings.customPlan ? [...pomoSettings.customPlan] : null,
    skipBreaks: [...(pomoSettings.skipBreaks || [])]
  };

  $('psWork').value = Math.floor(pomoSettings.work / 60);
  $('psWorkSec').value = pomoSettings.work % 60;
  $('psShort').value = Math.floor(pomoSettings.short / 60);
  $('psShortSec').value = pomoSettings.short % 60;
  $('psLong').value = Math.floor(pomoSettings.long / 60);
  $('psLongSec').value = pomoSettings.long % 60;
  // Sync cycle count from customPlan if one exists (so form always matches reality)
  if (isCustomPlan()) {
    const workCount = pomoSettings.customPlan.filter(t => t === 'work').length;
    $('psCycle').value = Math.max(1, workCount);
  } else {
    $('psCycle').value = pomoSettings.cycle;
  }
  $('psAutoAdv').checked = pomoSettings.autoAdv;
  refreshAllPresets();
  $('psBreakSlots').innerHTML = '';
  renderBreakSlots();
  updateSettingsPreview();
  openM('pomoSettingsModal');
});

// Cancel: restore snapshot so live changes are reverted
const cancelPomoSettings = () => {
  if (_origPomoSettings) {
    pomoSettings.work  = _origPomoSettings.work;
    pomoSettings.short = _origPomoSettings.short;
    pomoSettings.long  = _origPomoSettings.long;
    pomoSettings.cycle = _origPomoSettings.cycle;
    pomoSettings.autoAdv = _origPomoSettings.autoAdv;
    pomoSettings.customPlan = _origPomoSettings.customPlan;
    pomoSettings.skipBreaks = _origPomoSettings.skipBreaks;
    _origPomoSettings = null;
    if (!pomoRunning) setMode(mode);
    renderPlanStrip(); save();
  }
  // Modal closed by the generic data-close handler (runs before or after this)
};
// Wire both the X close and the Cancel button to also restore originals
document.querySelectorAll('[data-close="pomoSettingsModal"]').forEach(b => {
  b.addEventListener('click', cancelPomoSettings);
});

let _previewRendering = false; // guard against infinite loop
const updateSettingsPreview = () => {
  if (_previewRendering) return;
  _previewRendering = true;
  try {
    const wm = parseInt($('psWork').value)||25,  ws = parseInt($('psWorkSec').value)||0;
    const sm = parseInt($('psShort').value)||5,   ss = parseInt($('psShortSec').value)||0;
    const lm = parseInt($('psLong').value)||15,   ls = parseInt($('psLongSec').value)||0;
    const cy = parseInt($('psCycle').value)||4;

    // === LIVE APPLY durations immediately — plan strip reflects changes before APPLY ===
    const newWork  = Math.max(60, wm*60+ws);
    const newShort = Math.max(30, sm*60+ss);
    const newLong  = Math.max(60, lm*60+ls);
    pomoSettings.work  = newWork;
    pomoSettings.short = newShort;
    pomoSettings.long  = newLong;

    const secFor = t => t==='work'?newWork:t==='short'?newShort:newLong;

    // Keep break-slot count in sync with cycle field
    const slotCount = $('psBreakSlots').querySelectorAll('.break-slot').length;
    if (slotCount !== cy) renderBreakSlots();

    // === Build preview types ===
    // If a customPlan exists (from drag or previous apply), use it directly.
    // Otherwise build from cycle + slot states (type + enabled).
    let finalTypes;
    if (isCustomPlan()) {
      finalTypes = [...pomoSettings.customPlan];
    } else {
      finalTypes = [];
      const slots = $('psBreakSlots').querySelectorAll('.break-slot');
      for (let i = 0; i < cy; i++) {
        finalTypes.push('work');
        if (i < slots.length) {
          const cb      = slots[i].querySelector('input[type=checkbox]');
          const typeBtn = slots[i].querySelector('.bs-type-btn');
          if (cb && cb.checked) finalTypes.push(typeBtn ? typeBtn.dataset.type : 'short');
        }
      }
    }

    const blocks = finalTypes.map(t => ({ t, s: secFor(t) }));
    const total = blocks.reduce((s,b)=>s+b.s, 0);
    const workTotal = blocks.filter(b=>b.t==='work').reduce((s,b)=>s+b.s, 0);
    const sessions = blocks.filter(b=>b.t==='work').length;

    const pb = $('psPreviewBlocks'); pb.innerHTML = '';
    blocks.slice(0, 11).forEach(b => {
      const el = document.createElement('div');
      el.className = `plan-block ${b.t}`;
      el.textContent = fmtHuman(b.s);
      pb.appendChild(el);
    });
    if (blocks.length > 11) {
      const el = document.createElement('div');
      el.className = 'plan-block more';
      el.textContent = `+${blocks.length - 11}`;
      pb.appendChild(el);
    }
    $('psPreviewStat').innerHTML = `<b>${sessions} sessions</b> · total <b>${fmtHuman(total)}</b> (work: <b>${fmtHuman(workTotal)}</b>)`;

    // === LIVE SYNC: update the main timer ring/display ===
    if (!pomoRunning) {
      const livePreviewSec = mode === 'work' ? newWork : mode === 'short' ? newShort : newLong;
      pomoSec = livePreviewSec; pomoTotal = livePreviewSec;
      pomoDisp.textContent = fmtMS(pomoSec);
      updateRing();
      document.title = `${fmtMS(pomoSec)} — FOCUS`;
    }

    // Fix 6: refresh duration labels inside type buttons whenever steppers change
    $('psBreakSlots').querySelectorAll('.bs-type-btn').forEach(btn => {
      const t = btn.dataset.type;
      const dur = fmtHuman(t === 'short' ? newShort : newLong);
      btn.textContent = (t === 'long' ? 'LONG' : 'SHORT') + ' · ' + dur;
    });

    // === LIVE SYNC: update plan strip so outside reflects inside immediately ===
    renderPlanStrip();
  } finally {
    _previewRendering = false;
  }
};

// === STEPPER WIRING ===
const clampInput = el => {
  const v = parseInt(el.value) || 0;
  el.value = Math.max(parseInt(el.min)||0, Math.min(parseInt(el.max)||999, v));
};

// Hold-to-repeat state
let stepHoldTimer = null, stepHoldInterval = null;
const doStep = (targetId, delta) => {
  const el = $(targetId); if (!el) return;
  const secEl = $(targetId + 'Sec');
  if (secEl) {
    // Step the total duration by 1 minute, preserving seconds
    let totalSecs = (parseInt(el.value) || 0) * 60 + (parseInt(secEl.value) || 0);
    totalSecs = Math.max(0, totalSecs + delta * 60);
    const maxMins = parseInt(el.max) || 999;
    const clampedTotal = Math.min(maxMins * 60 + 59, totalSecs);
    el.value = Math.floor(clampedTotal / 60);
    secEl.value = clampedTotal % 60;
  } else {
    el.value = (parseInt(el.value) || 0) + delta;
    clampInput(el);
  }
  refreshPresets(targetId);
  updateSettingsPreview();
};
const startStep = (targetId, delta) => {
  doStep(targetId, delta);
  stepHoldTimer = setTimeout(() => {
    stepHoldInterval = setInterval(() => doStep(targetId, delta), 55);
  }, 280);
};
const stopStep = () => {
  clearTimeout(stepHoldTimer); clearInterval(stepHoldInterval);
  stepHoldTimer = stepHoldInterval = null;
};

document.querySelectorAll('.dur-btn').forEach(btn => {
  const delta = parseInt(btn.dataset.step);
  const target = btn.dataset.target;
  btn.addEventListener('pointerdown', e => { e.preventDefault(); startStep(target, delta); });
  btn.addEventListener('pointerup', stopStep);
  btn.addEventListener('pointerleave', stopStep);
  btn.addEventListener('pointercancel', stopStep);
});

// Preset chips
const refreshPresets = (targetId) => {
  const val = parseInt($(targetId)?.value);
  document.querySelectorAll(`.dur-presets[data-for="${targetId}"] .dur-preset, .cycle-presets .cycle-preset`).forEach(p => {
    if (p.closest(`[data-for="${targetId}"]`) || targetId === 'psCycle')
      p.classList.toggle('on', parseInt(p.dataset.val) === val);
  });
};
const refreshAllPresets = () => ['psWork','psShort','psLong','psCycle'].forEach(refreshPresets);

document.querySelectorAll('.dur-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.closest('.dur-presets').dataset.for;
    $(targetId).value = btn.dataset.val;
    refreshPresets(targetId);
    updateSettingsPreview();
  });
});
document.querySelectorAll('.cycle-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    $('psCycle').value = btn.dataset.val;
    refreshPresets('psCycle');
    renderBreakSlots();
    updateSettingsPreview();
  });
});

['psWork','psShort','psLong'].forEach(id => {
  const minEl = $(id); if (!minEl) return;
  const secEl = $(id + 'Sec');

  minEl.addEventListener('input', () => {
    clampInput(minEl);
    refreshPresets(id);
    updateSettingsPreview();
  });

  if (secEl) {
    secEl.addEventListener('input', () => {
      let s = parseInt(secEl.value);
      if (isNaN(s)) { updateSettingsPreview(); return; }
      if (s >= 60) {
        // Carry over extra seconds into minutes
        const carry = Math.floor(s / 60);
        const maxMins = parseInt(minEl.max) || 999;
        minEl.value = Math.min(maxMins, (parseInt(minEl.value) || 0) + carry);
        secEl.value = s % 60;
        refreshPresets(id);
      } else if (s < 0) {
        // Borrow from minutes
        const mins = parseInt(minEl.value) || 0;
        if (mins > 0) { minEl.value = mins - 1; secEl.value = 59; }
        else { secEl.value = 0; }
        refreshPresets(id);
      }
      updateSettingsPreview();
    });
  }
});
$('psAutoAdv').addEventListener('change', updateSettingsPreview);
$('psCycle').addEventListener('input', () => { refreshPresets('psCycle'); renderBreakSlots(); updateSettingsPreview(); });

$('savePomoSettings').addEventListener('click', () => {
  const cy = Math.max(1, Math.min(12, parseInt($('psCycle').value)||4));
  pomoSettings.cycle   = cy;
  pomoSettings.autoAdv = $('psAutoAdv').checked;
  // customPlan + durations already live-applied by updateSettingsPreview / applySlotsToPlan
  // If no customPlan was built yet (modal opened with all defaults), build it now from slots
  if (!isCustomPlan()) {
    const newPlan = [], newSkip = [];
    const slots = $('psBreakSlots').querySelectorAll('.break-slot');
    for (let i = 0; i < cy; i++) {
      newPlan.push('work');
      if (i < slots.length) {
        const cb      = slots[i].querySelector('input[type=checkbox]');
        const typeBtn = slots[i].querySelector('.bs-type-btn');
        if (cb && cb.checked) newPlan.push(typeBtn ? typeBtn.dataset.type : 'short');
        else newSkip.push(i + 1);
      }
    }
    pomoSettings.customPlan = newPlan;
    pomoSettings.skipBreaks = newSkip;
  }
  _origPomoSettings = null; // clear snapshot — user confirmed
  sessionsD = 0; planIdx = 0;
  clearInterval(pomoInterval); pomoRunning = false;
  setMode('work');
  renderPlanStrip(); updateAutoBadge();
  save(); closeM('pomoSettingsModal'); toast('Timer settings applied!');
});

// === KEYBOARD SHORTCUTS ===
document.addEventListener('keydown', e => {
  const tag=document.activeElement.tagName;
  const inInput=(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT');
  const modalOpen=!!document.querySelector('.overlay.open');
  if(e.code==='Space' && !inInput && !modalOpen){ e.preventDefault(); pomoStartBtn.click(); }
  if(e.code==='KeyR' && !inInput && !modalOpen){ e.preventDefault(); $('pomoReset').click(); }
  if(e.code==='Enter' && e.ctrlKey && !modalOpen){ e.preventDefault(); trackBtn.click(); }
});

// === TASK TRACKER ===
const updateRunningEntry = () => {
  if(!taskRunning||!taskStart) return;
  const elapsed=Date.now()-taskStart.getTime();
  liveTimer.textContent=fmt(elapsed);
  const durEl=entryList.querySelector('.e-dur.running');
  if(durEl) durEl.textContent=fmt(elapsed);
  updateTotals(elapsed);
};

const startLive = () => {
  if(taskInterval) clearInterval(taskInterval);
  taskInterval=setInterval(updateRunningEntry,1000);
};

taskInput.addEventListener('keydown', e => {
  if(e.key==='Enter' && !taskRunning){ e.preventDefault(); trackBtn.click(); }
});

trackBtn.addEventListener('click',()=>{
  if(!taskRunning){
    const desc=taskInput.value.trim();
    if(!desc){ toast('Enter a task description first.','err'); taskInput.focus(); return; }
    const pid=projSelect.value||null, pname=pid?projSelect.options[projSelect.selectedIndex].text:null;
    taskStart=new Date();
    activeEntry={id:uid(),task:desc,projectId:pid,projectName:pname,startTime:taskStart.toISOString(),endTime:null,durationMs:0};
    timeEntries.push(activeEntry); taskRunning=true;
    taskInput.readOnly=true; projSelect.disabled=true;
    trackBtn.innerHTML='<i class="fas fa-stop" aria-hidden="true"></i> STOP';
    trackBtn.classList.add('on'); trackBtn.setAttribute('aria-label','Stop task timer');
    liveTimer.classList.remove('off'); startLive();
    toast('Timer started!'); save(); rerender();
  } else {
    clearInterval(taskInterval);
    const end=new Date(), elapsed=end-taskStart;
    const idx=timeEntries.findIndex(e=>e.id===activeEntry.id);
    if(idx!==-1){ timeEntries[idx].endTime=end.toISOString(); timeEntries[idx].durationMs=elapsed; }
    updateGoalProgress(activeEntry.projectId,elapsed);
    activeEntry=null; taskStart=null; taskRunning=false;
    taskInput.readOnly=false; projSelect.disabled=false;
    taskInput.value=''; projSelect.value='';
    trackBtn.innerHTML='<i class="fas fa-play" aria-hidden="true"></i> START';
    trackBtn.classList.remove('on'); trackBtn.setAttribute('aria-label','Start task timer');
    liveTimer.classList.add('off'); liveTimer.textContent='00:00:00';
    toast('Timer stopped!'); save(); rerender();
  }
});

window.addEventListener('beforeunload', e => {
  if(taskRunning){ e.preventDefault(); e.returnValue='Timer is still running. Leave anyway?'; }
});

// === DATE NAV ===
$('prevDateBtn').addEventListener('click',()=>{
  const d=new Date(viewDate); d.setDate(d.getDate()-1); viewDate=d;
  calViewDate=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  renderEntries(); renderCalendar();
});
$('nextDateBtn').addEventListener('click',()=>{
  const d=new Date(viewDate); d.setDate(d.getDate()+1); viewDate=d;
  calViewDate=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  renderEntries(); renderCalendar();
});
$('goTodayBtn').addEventListener('click',()=>{
  viewDate=new Date();
  calViewDate=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  renderEntries(); renderCalendar();
});

// === CALENDAR ===
$('calPrevBtn').addEventListener('click',()=>{ calViewDate.setMonth(calViewDate.getMonth()-1); renderCalendar(); });
$('calNextBtn').addEventListener('click',()=>{ calViewDate.setMonth(calViewDate.getMonth()+1); renderCalendar(); });
$('calTodayBtn').addEventListener('click',()=>{ calViewDate=new Date(); calViewDate.setDate(1); renderCalendar(); });

const renderCalendar = () => {
  const y=calViewDate.getFullYear(), mo=calViewDate.getMonth();
  $('calMonthLabel').textContent=new Date(y,mo,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}).toUpperCase();

  // Days of week header (Mon–Sun)
  const dowRow=$('calDowRow'); dowRow.innerHTML='';
  ['M','T','W','T','F','S','S'].forEach(d=>{
    const el=document.createElement('div'); el.className='cal-dow'; el.textContent=d; dowRow.appendChild(el);
  });

  // Build day grid
  const grid=$('calGrid'); grid.innerHTML='';
  const firstDay=new Date(y,mo,1).getDay(); // 0=Sun
  // Offset: Mon-based grid (Mon=0 … Sun=6)
  const offset=(firstDay+6)%7;
  const daysInMonth=new Date(y,mo+1,0).getDate();
  const today=new Date();

  // Collect days that have entries
  const entryDays=new Set();
  timeEntries.forEach(e=>{
    if(!e.startTime) return;
    const d=new Date(e.startTime);
    if(d.getFullYear()===y&&d.getMonth()===mo) entryDays.add(d.getDate());
  });

  // Empty cells
  for(let i=0;i<offset;i++){
    const el=document.createElement('div'); el.className='cal-day empty'; grid.appendChild(el);
  }

  for(let d=1;d<=daysInMonth;d++){
    const el=document.createElement('div'); el.className='cal-day';
    const isToday=today.getFullYear()===y&&today.getMonth()===mo&&today.getDate()===d;
    const isSelected=viewDate.getFullYear()===y&&viewDate.getMonth()===mo&&viewDate.getDate()===d;
    if(isToday) el.classList.add('today');
    if(isSelected) el.classList.add('selected');

    const num=document.createElement('div'); num.className='cal-day-num'; num.textContent=d;
    el.appendChild(num);

    if(entryDays.has(d)){
      const dot=document.createElement('div'); dot.className='cal-dot'; el.appendChild(dot);
    }

    el.addEventListener('click',()=>{
      viewDate=new Date(y,mo,d);
      renderEntries(); renderCalendar();
    });
    grid.appendChild(el);
  }
};

// === POMO LOG ===
const logPomoSession = (m, sec) => {
  const today = new Date().toDateString();
  if (pomoLogDate !== today) { pomoLog = []; pomoLogDate = today; }
  pomoLog.push({ mode: m, sec, at: new Date().toISOString() });
  if (m === 'work') hmPersistPomo();
  save(); renderPomoLog(); renderPomoGoal();
};

const renderPomoLog = () => {
  const el = $('pomoLogList'); el.innerHTML = '';
  if (!pomoLog.length) { el.innerHTML = '<div class="empty">// no sessions yet today</div>'; return; }
  [...pomoLog].reverse().forEach((s, i) => {
    const num = pomoLog.length - i;
    const at = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div'); item.className = 'pomo-log-item';
    const label = s.mode === 'work' ? 'WRK' : s.mode === 'short' ? 'SHT' : 'LNG';
    item.innerHTML = `<span class="pl-idx">#${num}</span><span class="pl-mode ${s.mode}">${label}</span><span class="pl-time">${at}</span><span class="pl-dur">${fmtHuman(s.sec)}</span>`;
    el.appendChild(item);
  });
};

const renderPomoGoal = () => {
  const today = new Date().toDateString();
  if (pomoLogDate !== today && pomoLog.length) { pomoLog = []; pomoLogDate = today; }
  const done = pomoLog.filter(s => s.mode === 'work').length;
  const pct = Math.min(100, (done / pomoGoalTarget) * 100);
  $('pgDone').textContent = done;
  $('pgTarget').textContent = pomoGoalTarget;
  $('pgBar').style.width = pct + '%';
  $('pgBar').style.background = done >= pomoGoalTarget ? 'var(--green-b)' : 'var(--yellow)';
  $('pgStatus').textContent = done >= pomoGoalTarget ? '✓ GOAL MET!' : 'sessions today';
  $('pgGoalInput').value = pomoGoalTarget;
};

$('pgSetBtn').addEventListener('click', () => {
  const v = parseInt($('pgGoalInput').value);
  if (v >= 1 && v <= 24) { pomoGoalTarget = v; save(); renderPomoGoal(); toast(`Daily goal set to ${v} sessions`); }
});
$('pgGoalInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('pgSetBtn').click(); });
$('pgMinus').addEventListener('click', () => {
  const v = Math.max(1, parseInt($('pgGoalInput').value) - 1);
  $('pgGoalInput').value = v; pomoGoalTarget = v; save(); renderPomoGoal();
});
$('pgPlus').addEventListener('click', () => {
  const v = Math.min(24, parseInt($('pgGoalInput').value) + 1);
  $('pgGoalInput').value = v; pomoGoalTarget = v; save(); renderPomoGoal();
});

$('clearPomoLogBtn').addEventListener('click', () => {
  alert2('Clear today\'s pomo log?', true, ok => {
    if (!ok) return;
    pomoLog = []; pomoLogDate = new Date().toDateString();
    save(); renderPomoLog(); renderPomoGoal(); toast('Pomo log cleared.');
  });
});

// === RENDER ===
const rerender = () => { renderProjects(); renderEntries(); renderGoals(); updateTotals(); renderCalendar(); renderPomoLog(); renderPomoGoal(); };

const renderEntries = () => {
  const today=new Date();
  const isToday=sameDay(viewDate,today);
  const lbl=isToday?'TODAY':viewDate.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}).toUpperCase();
  $('entryDateLabel').textContent=lbl;
  $('dateLabel').textContent=viewDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

  const entries=timeEntries.filter(e=>e.startTime&&sameDay(new Date(e.startTime),viewDate)).sort((a,b)=>new Date(b.startTime)-new Date(a.startTime));
  entryList.innerHTML='';
  if(!entries.length){ entryList.innerHTML='<div class="empty" role="listitem">// no entries for this day</div>'; return; }
  entries.forEach(e=>{
    const isRunning=taskRunning&&activeEntry&&e.id===activeEntry.id;
    const s=new Date(e.startTime);
    const en=e.endTime?new Date(e.endTime):null;
    const color=e.projectId?projColor(e.projectId):'#665c54';
    const elapsed=isRunning?(Date.now()-taskStart.getTime()):e.durationMs;
    const d=document.createElement('div'); d.className='entry'+(isRunning?' running':''); d.setAttribute('role','listitem');
    d.innerHTML=`<div class="e-bar" style="background:${color}"></div>
      <div class="e-body">
        <div class="e-task" title="${e.task}">${e.task}</div>
        <div class="e-meta">${e.projectName||'no project'} · ${s.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${en?' → '+en.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):isRunning?' → <span style="color:var(--green-b)">running</span>':''}</div>
      </div>
      <div class="e-dur${isRunning?' running':''}">${fmt(elapsed)}</div>
      <div class="e-acts">
        <button class="ea ed" onclick="openEE('${e.id}')" title="Edit entry" aria-label="Edit entry"><i class="fas fa-pen" aria-hidden="true"></i></button>
        <button class="ea dl" onclick="delEntry('${e.id}')" title="Delete entry" aria-label="Delete entry"><i class="fas fa-trash" aria-hidden="true"></i></button>
      </div>`;
    entryList.appendChild(d);
  });
};

const updateTotals = (liveElapsed = 0) => {
  const now = new Date(); let td = 0, wk = 0, mo = 0;
  timeEntries.forEach(e => {
    if (!e.startTime || typeof e.durationMs !== 'number') return;
    const d = new Date(e.startTime);
    if (sameDay(d, now)) td += e.durationMs;
    if (sameWeek(d, now)) wk += e.durationMs;
    if (sameMon(d, now)) mo += e.durationMs;
  });
  if (taskRunning && taskStart && liveElapsed > 0) {
    if (sameDay(taskStart, now)) td += liveElapsed;
    if (sameWeek(taskStart, now)) wk += liveElapsed;
    if (sameMon(taskStart, now)) mo += liveElapsed;
  }
  $('todayTotal').textContent = fmt(td);
  $('weekTotal').textContent = fmt(wk);
  $('monthTotal').textContent = fmt(mo);
  // Daily average: total this week / number of days in week that have any entries
  const weekDays = new Set();
  timeEntries.forEach(e => { if (e.startTime && sameWeek(new Date(e.startTime), now)) weekDays.add(new Date(e.startTime).toDateString()); });
  if (taskRunning && taskStart && sameWeek(taskStart, now)) weekDays.add(taskStart.toDateString());
  const daysTracked = Math.max(1, weekDays.size);
  $('dayAvg').textContent = fmt(Math.round(wk / daysTracked));
};

const renderGoals = () => {
  goalList.innerHTML='';
  if(!goals.length){ goalList.innerHTML='<div class="empty" role="listitem">// no goals set</div>'; return; }
  const now=new Date();
  goals.forEach(g=>{
    const lr=new Date(g.lastResetDate);
    const reset=(g.frequency==='day'&&!sameDay(now,lr))||(g.frequency==='week'&&!sameWeek(now,lr))||(g.frequency==='month'&&!sameMon(now,lr));
    if(reset){ g.currentMs=0; g.lastResetDate=now.toISOString(); }
    const pct=Math.min(100,(g.currentMs/g.targetMs)*100||0);
    const circ=100.53, offset=circ*(1-pct/100);
    const ended=g.endDate&&now>new Date(g.endDate);
    const rawPct=(g.currentMs/g.targetMs)*100||0;
    const exceeded=(g.type==='atMost')&&rawPct>100;
    const displayPct=Math.round(Math.min(rawPct,999));
    const d=document.createElement('div'); d.className='goal-item'; d.setAttribute('role','listitem');
    d.innerHTML=`<div class="g-ring" aria-hidden="true">
        <svg viewBox="0 0 38 38"><circle class="grb" cx="19" cy="19" r="16"/><circle class="grf${exceeded?' exceeded':''}" cx="19" cy="19" r="16" style="stroke-dashoffset:${offset}"/></svg>
        <div class="g-pct${exceeded?' exceeded':''}">${displayPct}%</div></div>
      <div class="g-body">
        <div class="g-name">${g.name}${ended?' <span style="color:var(--red-b);font-size:8px">[ENDED]</span>':''}${exceeded?' <span style="color:var(--red-b);font-size:8px">[OVER]</span>':''}</div>
        <div class="g-meta">${g.type==='atLeast'?'≥':'≤'} ${fmt(g.targetMs)} / ${g.frequency} · ${fmt(g.currentMs)} tracked${g.projectName?' · '+g.projectName:''}</div>
      </div>
      <div class="iacts">
        <button class="ia ed" onclick="openEG('${g.id}')" title="Edit goal" aria-label="Edit goal"><i class="fas fa-pen" aria-hidden="true"></i></button>
        <button class="ia dl" onclick="delGoal('${g.id}')" title="Delete goal" aria-label="Delete goal"><i class="fas fa-trash" aria-hidden="true"></i></button>
      </div>`;
    goalList.appendChild(d);
  });
};

const renderProjects = () => {
  projList.innerHTML='';
  if(!projects.length){ projList.innerHTML='<div class="empty" role="listitem">// no projects</div>'; return; }
  projects.forEach((p,i)=>{
    const total=timeEntries.reduce((s,e)=>e.projectId===p.id?s+e.durationMs:s,0);
    const color=PROJ_COLORS[i%PROJ_COLORS.length];
    const d=document.createElement('div'); d.className='proj-item'; d.setAttribute('role','listitem');
    d.innerHTML=`<div class="p-dot" style="background:${color}" aria-hidden="true"></div>
      <div class="p-body"><div class="p-name">${p.name}</div><div class="p-total">${fmt(total)} tracked</div></div>
      <div class="iacts">
        <button class="ia ed" onclick="openEP('${p.id}')" title="Edit project" aria-label="Edit project"><i class="fas fa-pen" aria-hidden="true"></i></button>
        <button class="ia dl" onclick="delProject('${p.id}')" title="Delete project" aria-label="Delete project"><i class="fas fa-trash" aria-hidden="true"></i></button>
      </div>`;
    projList.appendChild(d);
  });
  populateSelects();
};

const populateSelects = () => {
  const selGroups=[
    {el:projSelect, placeholder:'— no project —'},
    {el:$('gProj'),  placeholder:'All Projects'},
    {el:$('rProj'),  placeholder:'All Projects'},
    {el:$('eeProj'), placeholder:'— no project —'},
    {el:$('egProj'), placeholder:'All Projects'},
  ];
  selGroups.forEach(({el,placeholder})=>{
    const v=el.value; el.innerHTML=`<option value="">${placeholder}</option>`;
    projects.forEach(p=>el.add(new Option(p.name,p.id))); el.value=v;
  });
};

// === GOAL PROGRESS ===
const updateGoalProgress = (projId,ms) => {
  goals.forEach(g=>{
    if(!g.endDate||new Date()<=new Date(g.endDate)){
      if(!g.projectId||g.projectId===projId) g.currentMs+=ms;
    }
  });
  save();
};

// === ERROR HELPERS ===
const showErr = (eid,iid) => { $(eid).classList.add('show'); if(iid) $(iid).classList.add('err'); };
const hideErr = (eid,iid) => { $(eid).classList.remove('show'); if(iid) $(iid).classList.remove('err'); };
const clearErrs = mid => { $(mid).querySelectorAll('.errmsg').forEach(e=>e.classList.remove('show')); $(mid).querySelectorAll('.err').forEach(e=>e.classList.remove('err')); };

// === CREATE GOAL ===
$('openGoalBtn').addEventListener('click',()=>{
  ['gName','gHours','gMins','gUntil'].forEach(id=>$(id).value='');
  $('gNoEnd').checked=false; $('gUntil').disabled=false; $('gProj').value=''; $('gType').value='atLeast';
  clearErrs('createGoalModal'); openM('createGoalModal');
});
$('gNoEnd').addEventListener('change',function(){ $('gUntil').disabled=this.checked; if(this.checked) $('gUntil').value=''; });
$('gHours').addEventListener('input',function(){ sanitize(this); });
$('gMins').addEventListener('input',function(){ sanitize(this,59); });
$('createGoalBtn').addEventListener('click',()=>{
  const name=$('gName').value.trim(),h=parseInt($('gHours').value)||0,m=parseInt($('gMins').value)||0;
  const ms=(h*3600+m*60)*1000,noEnd=$('gNoEnd').checked,end=noEnd?null:$('gUntil').value;
  let ok=true;
  if(!name){ showErr('gNameErr','gName'); ok=false; } else hideErr('gNameErr','gName');
  if(ms<=0){ showErr('gTimeErr','gHours'); ok=false; } else hideErr('gTimeErr','gHours');
  if(!noEnd&&!end){ showErr('gDateErr','gUntil'); ok=false; } else hideErr('gDateErr','gUntil');
  if(!ok) return;
  const pid=$('gProj').value||null,pname=pid?$('gProj').options[$('gProj').selectedIndex].text:null;
  goals.push({id:uid(),name,type:$('gType').value,targetMs:ms,frequency:$('gFreq').value,endDate:end,currentMs:0,lastResetDate:new Date().toISOString(),projectId:pid,projectName:pname});
  save(); rerender(); closeM('createGoalModal'); toast('Goal created!');
});

// === CREATE PROJECT ===
$('openProjBtn').addEventListener('click',()=>{ $('pName').value=''; clearErrs('createProjModal'); openM('createProjModal'); });
$('createProjBtn').addEventListener('click',()=>{
  const name=$('pName').value.trim();
  if(!name){ showErr('pNameErr','pName'); return; }
  if(projects.some(p=>p.name.toLowerCase()===name.toLowerCase())){ $('pNameErr').textContent='Project already exists.'; showErr('pNameErr','pName'); return; }
  hideErr('pNameErr','pName');
  projects.push({id:uid(),name}); save(); rerender(); closeM('createProjModal'); toast('Project created!');
});

// === EDIT ENTRY ===
window.openEE = id => {
  const e=timeEntries.find(x=>x.id===id); if(!e) return;
  if(taskRunning&&activeEntry&&e.id===activeEntry.id){ toast('Stop the timer first.','err'); return; }
  $('eeId').value=e.id; $('eeTask').value=e.task; $('eeProj').value=e.projectId||'';
  clearErrs('editEntryModal'); openM('editEntryModal');
};
$('saveEntryBtn').addEventListener('click',()=>{
  const id=$('eeId').value,task=$('eeTask').value.trim();
  if(!task){ showErr('eeTaskErr','eeTask'); return; } hideErr('eeTaskErr','eeTask');
  const idx=timeEntries.findIndex(e=>e.id===id);
  if(idx!==-1){
    const pid=$('eeProj').value||null;
    timeEntries[idx].task=task; timeEntries[idx].projectId=pid;
    timeEntries[idx].projectName=pid?$('eeProj').options[$('eeProj').selectedIndex].text:null;
    save(); rerender(); closeM('editEntryModal'); toast('Entry updated!');
  }
});

// === EDIT GOAL ===
window.openEG = id => {
  const g=goals.find(x=>x.id===id); if(!g) return;
  $('egId').value=g.id; $('egName').value=g.name; $('egProj').value=g.projectId||'';
  $('egType').value=g.type||'atLeast'; $('egHours').value=Math.floor(g.targetMs/3600000);
  $('egMins').value=Math.floor((g.targetMs%3600000)/60000); $('egFreq').value=g.frequency;
  $('egUntil').value=g.endDate||''; $('egNoEnd').checked=!g.endDate; $('egUntil').disabled=!g.endDate;
  clearErrs('editGoalModal'); openM('editGoalModal');
};
$('egNoEnd').addEventListener('change',function(){ $('egUntil').disabled=this.checked; if(this.checked) $('egUntil').value=''; });
$('egHours').addEventListener('input',function(){ sanitize(this); });
$('egMins').addEventListener('input',function(){ sanitize(this,59); });
$('saveGoalBtn').addEventListener('click',()=>{
  const id=$('egId').value,name=$('egName').value.trim(),h=parseInt($('egHours').value)||0,m=parseInt($('egMins').value)||0;
  const ms=(h*3600+m*60)*1000,noEnd=$('egNoEnd').checked,end=noEnd?null:$('egUntil').value;
  let ok=true;
  if(!name){ showErr('egNameErr','egName'); ok=false; } else hideErr('egNameErr','egName');
  if(ms<=0){ showErr('egTimeErr','egHours'); ok=false; } else hideErr('egTimeErr','egHours');
  if(!noEnd&&!end){ showErr('egDateErr','egUntil'); ok=false; } else hideErr('egDateErr','egUntil');
  if(!ok) return;
  const idx=goals.findIndex(g=>g.id===id);
  if(idx!==-1){
    const pid=$('egProj').value||null;
    goals[idx]={...goals[idx],name,type:$('egType').value,targetMs:ms,frequency:$('egFreq').value,endDate:end,projectId:pid,projectName:pid?$('egProj').options[$('egProj').selectedIndex].text:null};
    save(); rerender(); closeM('editGoalModal'); toast('Goal updated!');
  }
});

// === EDIT PROJECT ===
window.openEP = id => {
  const p=projects.find(x=>x.id===id); if(!p) return;
  $('epId').value=p.id; $('epName').value=p.name;
  clearErrs('editProjModal'); openM('editProjModal');
};
$('saveProjBtn').addEventListener('click',()=>{
  const id=$('epId').value,name=$('epName').value.trim();
  if(!name){ showErr('epNameErr','epName'); return; }
  if(projects.some(p=>p.name.toLowerCase()===name.toLowerCase()&&p.id!==id)){ showErr('epDupErr','epName'); return; }
  hideErr('epNameErr','epName'); hideErr('epDupErr','epName');
  const idx=projects.findIndex(p=>p.id===id);
  if(idx!==-1){
    projects[idx].name=name;
    timeEntries.forEach(e=>{ if(e.projectId===id) e.projectName=name; });
    goals.forEach(g=>{ if(g.projectId===id) g.projectName=name; });
    save(); rerender(); closeM('editProjModal'); toast('Project updated!');
  }
});

// === DELETE ===
window.delEntry = id => alert2('Delete this time entry?',true,ok=>{
  if(!ok) return;
  if(taskRunning&&activeEntry&&activeEntry.id===id){ toast("Stop the timer first.",'err'); return; }
  timeEntries=timeEntries.filter(e=>e.id!==id); save(); rerender(); toast('Entry deleted.');
});
window.delGoal = id => alert2('Delete this goal?',true,ok=>{ if(!ok) return; goals=goals.filter(g=>g.id!==id); save(); rerender(); toast('Goal deleted.'); });
window.delProject = id => {
  const isRunning=taskRunning&&activeEntry&&activeEntry.projectId===id;
  const msg=isRunning?'This project has a running timer. Stop it first, or delete anyway?':'Delete this project and all associated data?';
  alert2(msg,true,ok=>{
    if(!ok) return;
    projects=projects.filter(p=>p.id!==id);
    timeEntries=timeEntries.filter(e=>e.projectId!==id);
    goals=goals.filter(g=>g.projectId!==id);
    if(isRunning&&activeEntry){ activeEntry.projectId=null; activeEntry.projectName=null; }
    save(); rerender(); toast('Project deleted.');
  });
};

// === REPORTS ===
$('openReportBtn').addEventListener('click',()=>{
  $('rProj').value=''; $('rStart').value=''; $('rEnd').value='';
  $('rList').innerHTML='<div class="empty">// run a report to see results</div>';
  $('rTotal').style.display='none';
  hideErr('rDateErr','rStart'); openM('reportModal');
});
$('genReportBtn').addEventListener('click',()=>{
  const pid=$('rProj').value||null;
  let s=$('rStart').value?parseDateLocal($('rStart').value):null;
  let e=$('rEnd').value?parseDateLocal($('rEnd').value):null;
  if(e) e.setHours(23,59,59,999);
  if(s&&e&&s>e){ $('rDateErr').classList.add('show'); return; } $('rDateErr').classList.remove('show');
  const filtered=timeEntries.filter(x=>{
    const d=new Date(x.startTime);
    return (!pid||x.projectId===pid)&&(!s||d>=s)&&(!e||d<=e);
  }).sort((a,b)=>new Date(b.startTime)-new Date(a.startTime));
  const rList=$('rList'); rList.innerHTML='';
  if(!filtered.length){ rList.innerHTML='<div class="empty">// no entries match</div>'; $('rTotal').style.display='none'; return; }
  let total=0;
  filtered.forEach(x=>{
    total+=x.durationMs;
    const st=new Date(x.startTime),en=x.endTime?new Date(x.endTime):null;
    const d=document.createElement('div'); d.className='rentry';
    d.innerHTML=`<div class="rentry-h"><span>${x.task}</span><span style="color:var(--aqua-b)">${fmt(x.durationMs)}</span></div>
      <div class="rentry-m">${x.projectName||'no project'} · ${st.toLocaleDateString()} ${st.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${en?' → '+en.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):' → running'}</div>`;
    rList.appendChild(d);
  });
  $('rTotalVal').textContent=fmt(total);
  $('rTotal').style.display='flex';
  toast('Report generated!');
});

// === EXPORT/IMPORT ===
$('openExportBtn').addEventListener('click',()=>openM('exportModal'));
$('confirmExportBtn').addEventListener('click',()=>{
  const b=new Blob([JSON.stringify({projects,goals,timeEntries},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download=`focus_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  closeM('exportModal'); toast('Export started!');
});
$('openImportBtn').addEventListener('click',()=>{
  $('importFile').value=''; $('fileNameDisplay').textContent='Choose a .json file…';
  hideErr('importFileErr','importFile'); openM('importModal');
});
$('importFile').addEventListener('change',function(){
  $('fileNameDisplay').textContent=this.files[0]?this.files[0].name:'Choose a .json file…';
});
$('confirmImportBtn').addEventListener('click',()=>{
  const file=$('importFile').files[0];
  if(!file){ $('importFileErr').classList.add('show'); return; } $('importFileErr').classList.remove('show');
  const reader=new FileReader();
  reader.onload=e=>{ try {
    const data=JSON.parse(e.target.result);
    if(!Array.isArray(data.timeEntries)||!Array.isArray(data.goals)||!Array.isArray(data.projects)) throw new Error('Invalid format');
    const m=document.querySelector('input[name="importMode"]:checked').value;
    if(m==='replace'){ timeEntries=data.timeEntries; goals=data.goals; projects=data.projects; toast('Data replaced!'); }
    else { const merge=(a,b)=>{ const ids=new Set(a.map(x=>x.id)); return [...a,...b.filter(x=>!ids.has(x.id))]; }; timeEntries=merge(timeEntries,data.timeEntries); goals=merge(goals,data.goals); projects=merge(projects,data.projects); toast('Data merged!'); }
    save(); rerender(); closeM('importModal');
  } catch(err){ toast('Import failed: '+err.message,'err'); } };
  reader.readAsText(file);
});

// === INIT ===
window.onload = () => {
  ringFg.style.strokeDasharray=CIRC;
  load();
  setMode('work');
  renderPlanStrip();
  updateAutoBadge();
  rerender();
  renderPomoLog();
  renderPomoGoal();
  calViewDate=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  renderCalendar();
};
// === HEATMAP ===
const HM_DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const HM_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Data aggregation ──────────────────────────────────────────────────────
const hmBuildDayMap = () => {
  // Map: 'YYYY-MM-DD' → { ms: totalTrackedMs, pomos: completed work sessions }
  const map = {};
  const key = d => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  };
  timeEntries.forEach(e => {
    if (!e.endTime || !e.durationMs) return;
    const k = key(e.startTime || e.endTime);
    if (!map[k]) map[k] = { ms: 0, pomos: 0 };
    map[k].ms += e.durationMs;
  });
  // Persist pomo log per-day via localStorage key 'tt_ph' (pomo history)
  const ph = JSON.parse(localStorage.getItem('tt_ph') || '{}');
  // Merge today's live pomoLog into ph
  if (pomoLog.length) {
    const todayKey = key(new Date().toISOString());
    ph[todayKey] = (ph[todayKey] || 0) + pomoLog.filter(s => s.mode === 'work').length;
    localStorage.setItem('tt_ph', JSON.stringify(ph));
  }
  Object.entries(ph).forEach(([k, count]) => {
    if (!map[k]) map[k] = { ms: 0, pomos: 0 };
    map[k].pomos = Math.max(map[k].pomos, count);
  });
  return map;
};

const hmLevel = (ms, max) => {
  if (!ms || ms === 0) return 0;
  const h = ms / 3600000;
  if (max === 0) return 0;
  const ratio = h / max;
  if (ratio < 0.15) return 1;
  if (ratio < 0.35) return 2;
  if (ratio < 0.65) return 3;
  return 4;
};

const hmStreaks = dayMap => {
  const keys = Object.keys(dayMap).filter(k => dayMap[k].ms > 0).sort();
  if (!keys.length) return { current: 0, longest: 0, totalActiveDays: 0 };
  let longest = 1, cur = 1, current = 0;
  for (let i = 1; i < keys.length; i++) {
    const prev = new Date(keys[i-1]), curr = new Date(keys[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) { cur++; longest = Math.max(longest, cur); }
    else cur = 1;
  }
  // Current streak: count back from today
  const todayStr = new Date().toISOString().slice(0,10);
  let d = new Date(), streak = 0;
  while (true) {
    const k = d.toISOString().slice(0,10);
    if (dayMap[k] && dayMap[k].ms > 0) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return { current: streak, longest, totalActiveDays: keys.length };
};

const hmBestHour = () => {
  // Finds the hour-of-day with most tracked time across all entries
  const hourMs = new Array(24).fill(0);
  timeEntries.forEach(e => {
    if (!e.startTime || !e.durationMs) return;
    const h = new Date(e.startTime).getHours();
    hourMs[h] += e.durationMs;
  });
  const maxH = hourMs.indexOf(Math.max(...hourMs));
  if (hourMs[maxH] === 0) return null;
  const ampm = maxH >= 12 ? 'PM' : 'AM', h12 = maxH % 12 || 12;
  return `${h12}${ampm}`;
};

const hmBurnoutGaps = dayMap => {
  // Finds gaps of 3+ days with no activity in last 90 days
  const gaps = [];
  const today = new Date(); today.setHours(0,0,0,0);
  const start90 = new Date(today); start90.setDate(today.getDate()-90);
  let gapStart = null, gapLen = 0;
  for (let d = new Date(start90); d <= today; d.setDate(d.getDate()+1)) {
    const k = d.toISOString().slice(0,10);
    if (!dayMap[k] || dayMap[k].ms === 0) {
      if (!gapStart) gapStart = new Date(d);
      gapLen++;
    } else {
      if (gapLen >= 3) gaps.push({ start: new Date(gapStart), len: gapLen });
      gapStart = null; gapLen = 0;
    }
  }
  if (gapLen >= 3) gaps.push({ start: new Date(gapStart), len: gapLen });
  return gaps.slice(-5); // last 5 burnout gaps
};

// ── Date range helpers ────────────────────────────────────────────────────
const hmDateRange = view => {
  const now = new Date(); now.setHours(0,0,0,0);
  if (view === 'week') {
    const s = new Date(now); s.setDate(now.getDate() - now.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: s, end: e };
  }
  if (view === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth()+1, 0);
    return { start: s, end: e };
  }
  // year: last 52 weeks from last Sunday
  const end = new Date(now); end.setDate(now.getDate() - now.getDay() + 6);
  const start = new Date(end); start.setDate(end.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // align to Sunday
  return { start, end };
};

// ── Render ────────────────────────────────────────────────────────────────
const hmTooltipEl = document.getElementById('hmTooltip');

const hmShowTooltip = (cell, dateKey, data, e) => {
  const d = new Date(dateKey + 'T00:00:00');
  const hrs = data ? (data.ms / 3600000).toFixed(1) : '0.0';
  const pomos = data ? data.pomos : 0;
  hmTooltipEl.innerHTML =
    `<div class="hm-tooltip-date">${HM_DAYS[d.getDay()]}, ${HM_MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}</div>
     <div class="hm-tooltip-row"><span class="hm-tooltip-lbl">Tracked</span><span class="hm-tooltip-val">${hrs}h</span></div>
     <div class="hm-tooltip-row"><span class="hm-tooltip-lbl">Pomodoros</span><span class="hm-tooltip-val">${pomos}</span></div>`;
  hmTooltipEl.classList.add('show');
  hmMoveTooltip(e);
};

const hmMoveTooltip = e => {
  const x = e.clientX + 14, y = e.clientY - 10;
  const w = hmTooltipEl.offsetWidth, h = hmTooltipEl.offsetHeight;
  hmTooltipEl.style.left = (x + w > window.innerWidth ? x - w - 28 : x) + 'px';
  hmTooltipEl.style.top  = (y + h > window.innerHeight ? y - h : y) + 'px';
};

const hmHideTooltip = () => hmTooltipEl.classList.remove('show');

const renderHeatmap = () => {
  const dayMap = hmBuildDayMap();
  const { start, end } = hmDateRange('year');
  const today = new Date(); today.setHours(0,0,0,0);
  const todayKey = today.toISOString().slice(0,10);

  // Max hours in range for level scaling
  let maxMs = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    const k = d.toISOString().slice(0,10);
    if (dayMap[k]) maxMs = Math.max(maxMs, dayMap[k].ms);
  }

  // Build weeks array (columns of 7 days)
  const weeks = [];
  let week = [];
  // Pad start to Sunday
  const cur = new Date(start);
  for (let i = 0; i < cur.getDay(); i++) week.push(null); // empty pads
  for (; cur <= end; cur.setDate(cur.getDate()+1)) {
    week.push(new Date(cur));
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // Month labels (year view only)
  const mlEl = $('hmMonthLabels'); mlEl.innerHTML = '';
  if (true) {
    let lastMonth = -1;
    weeks.forEach(wk => {
      const firstReal = wk.find(d => d);
      const m = firstReal ? firstReal.getMonth() : -1;
      const lbl = document.createElement('div');
      lbl.className = 'hm-month-lbl';
      lbl.style.width = '13px';
      lbl.textContent = (m !== lastMonth && firstReal) ? HM_MONTHS[m] : '';
      if (m !== lastMonth && firstReal) lastMonth = m;
      mlEl.appendChild(lbl);
    });
  }

  // Day labels
  const dlEl = $('hmDayLabels'); dlEl.innerHTML = '';
  const dayLblSet = false
    ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    : ['','Mon','','Wed','','Fri',''];
  dayLblSet.forEach(lbl => {
    const el = document.createElement('div');
    el.className = 'hm-day-lbl';
    el.textContent = lbl;
    dlEl.appendChild(el);
  });

  // Cells
  const weeksEl = $('hmWeeks'); weeksEl.innerHTML = '';
  weeks.forEach(wk => {
    const col = document.createElement('div');
    col.className = 'hm-week';
    wk.forEach(day => {
      const cell = document.createElement('div');
      if (!day) { cell.className = 'hm-cell empty'; col.appendChild(cell); return; }
      const k = day.toISOString().slice(0,10);
      const isFuture = day > today;
      const data = dayMap[k];
      const lvl = isFuture ? 'future' : hmLevel(data ? data.ms : 0, maxMs / 3600000);
      cell.className = `hm-cell ${isFuture ? 'future' : 'l'+lvl}${k === todayKey ? ' today-cell' : ''}`;
      if (!isFuture) {
        cell.addEventListener('mouseenter', e => hmShowTooltip(cell, k, data, e));
        cell.addEventListener('mousemove', hmMoveTooltip);
        cell.addEventListener('mouseleave', hmHideTooltip);
      }
      col.appendChild(cell);
    });
    weeksEl.appendChild(col);
  });

  // Stats
  const streaks = hmStreaks(dayMap);
  const bestHour = hmBestHour();
  const totalPomos = Object.values(dayMap).reduce((s,d)=>s+d.pomos,0);
  const totalMs = Object.values(dayMap).reduce((s,d)=>s+d.ms,0);
  const totalHrs = (totalMs/3600000).toFixed(1);

  $('hmStats').innerHTML = `
    <div class="hm-stat streak">
      <div class="hm-stat-val">${streaks.current}</div>
      <div class="hm-stat-lbl">CURRENT STREAK</div>
      <div class="hm-stat-sub">days in a row</div>
    </div>
    <div class="hm-stat streak">
      <div class="hm-stat-val">${streaks.longest}</div>
      <div class="hm-stat-lbl">LONGEST STREAK</div>
      <div class="hm-stat-sub">all time</div>
    </div>
    <div class="hm-stat best">
      <div class="hm-stat-val">${streaks.totalActiveDays}</div>
      <div class="hm-stat-lbl">ACTIVE DAYS</div>
      <div class="hm-stat-sub">all time</div>
    </div>
    <div class="hm-stat pomo">
      <div class="hm-stat-val">${totalPomos}</div>
      <div class="hm-stat-lbl">TOTAL POMOS</div>
      <div class="hm-stat-sub">${totalHrs}h tracked</div>
    </div>
    <div class="hm-stat hour">
      <div class="hm-stat-val">${bestHour || '--'}</div>
      <div class="hm-stat-lbl">BEST HOUR</div>
      <div class="hm-stat-sub">peak focus time</div>
    </div>`;

  // Trend bars (last 7 days)
  const trendEl = $('hmTrend');
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate()-i);
    const k = d.toISOString().slice(0,10);
    last7.push({ label: HM_DAYS[d.getDay()].slice(0,3), ms: dayMap[k]?.ms || 0 });
  }
  const maxDay = Math.max(...last7.map(d=>d.ms), 1);
  trendEl.innerHTML = `<div class="hm-trend-title">LAST 7 DAYS</div>` +
    last7.map(d => {
      const hrs = (d.ms/3600000).toFixed(1);
      const pct = Math.round((d.ms/maxDay)*100);
      return `<div class="hm-bar-row">
        <div class="hm-bar-lbl">${d.label}</div>
        <div class="hm-bar-track"><div class="hm-bar-fill" style="width:${pct}%"></div></div>
        <div class="hm-bar-val">${hrs}h</div>
      </div>`;
    }).join('');

  // Burnout gaps
  const gaps = hmBurnoutGaps(dayMap);
  const burnEl = $('hmBurnout');
  if (gaps.length) {
    burnEl.innerHTML = `<div class="hm-burnout-title">BURNOUT GAPS (last 90 days)</div>` +
      gaps.map(g => {
        const end = new Date(g.start); end.setDate(g.start.getDate()+g.len-1);
        return `<span class="hm-gap-chip"><i class="fas fa-triangle-exclamation"></i> ${g.len}-day gap · ${HM_MONTHS[g.start.getMonth()]} ${g.start.getDate()}–${end.getDate()}</span>`;
      }).join('');
  } else {
    burnEl.innerHTML = `<div class="hm-burnout-title" style="color:var(--green-b)">✓ NO BURNOUT GAPS IN LAST 90 DAYS</div>`;
  }
};

// ── Tab wiring ────────────────────────────────────────────────────────────


// Save pomos to persistent history whenever a work session completes
const hmPersistPomo = () => {
  const ph = JSON.parse(localStorage.getItem('tt_ph') || '{}');
  const k = new Date().toISOString().slice(0,10);
  ph[k] = (ph[k] || 0) + 1;
  localStorage.setItem('tt_ph', JSON.stringify(ph));
};

$('openHeatmapBtn').addEventListener('click', () => {

  renderHeatmap();
  openM('heatmapModal');
});


// === HABITS & ROUTINES ===
// Schema: {id, name, icon, color, category, reminder, recurrence, customDays, createdAt, archived, order}
// Completions: tt_hc → {'YYYY-MM-DD': [habitId, ...]}
let habits = JSON.parse(localStorage.getItem('tt_hab') || '[]');

const HAB_COLORS = ['#b8bb26','#83a598','#fe8019','#d3869b','#8ec07c','#fabd2f','#fb4934','#458588','#b16286'];
const HAB_EMOJIS = ['📚','💪','💧','😴','🧘','✍️','🏃','🎯','🍎','💊','🧠','🎵','🌿','⚡','🔥','📝','🏊','🚴','🥗','🛌','🧘','🧹','☕','🌅','🚶','🎨','📖','💻','🤸','🫁'];
const HAB_CATS   = ['All','General','Health','Fitness','Mind','Learning','Social','Creative'];
const HAB_CIRC   = 2 * Math.PI * 30; // ring circumference

let habViewDate    = new Date();
let habView        = 'today';
let habCatFilter   = 'All';
let habSort        = 'order';
let habStripOffset = 0; // days offset for the strip
let habStreakCache  = {};
let habEditOpen    = null; // id of habit currently being edited
let habAddIcon     = '📚';
let habAddColor    = '#b8bb26';
let habAddRecur    = 'daily';
let habAddCustomDays = [1,2,3,4,5,6,0];
let habShowArchived = false;

const habKey = d => { const dt=new Date(d); dt.setHours(0,0,0,0); return dt.toISOString().slice(0,10); };
const habComp = () => JSON.parse(localStorage.getItem('tt_hc')||'{}');
const habSaveComp = m => localStorage.setItem('tt_hc', JSON.stringify(m));
const habSave = () => { localStorage.setItem('tt_hab', JSON.stringify(habits)); habStreakCache={}; };
const habDone = (id,k) => (habComp()[k]||[]).includes(id);

const habIsScheduled = (h, date) => {
  const d = new Date(date); const dow = d.getDay();
  if (!h.recurrence || h.recurrence==='daily') return true;
  if (h.recurrence==='weekdays') return dow>=1&&dow<=5;
  if (h.recurrence==='weekends') return dow===0||dow===6;
  if (h.recurrence==='custom') return (h.customDays||[]).includes(dow);
  return true;
};

const habStreak = id => {
  if (habStreakCache[id] !== undefined) return habStreakCache[id];
  const c = habComp(); const h = habits.find(x=>x.id===id); if (!h) return 0;
  let streak=0, d=new Date(); d.setHours(0,0,0,0);
  // If today is scheduled but not yet done, start from yesterday
  const todayKey = habKey(d);
  if (habIsScheduled(h, d) && !(c[todayKey]||[]).includes(id)) d.setDate(d.getDate()-1);
  for(let i=0;i<365;i++){
    const k=habKey(d);
    if (!habIsScheduled(h,d)) { d.setDate(d.getDate()-1); continue; }
    if ((c[k]||[]).includes(id)) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  habStreakCache[id]=streak; return streak;
};

const habLongestStreak = id => {
  const c=habComp(); const h=habits.find(x=>x.id===id); if(!h) return 0;
  let longest=0,cur=0,d=new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()-364);
  for(let i=0;i<365;i++){
    const k=habKey(d);
    if(habIsScheduled(h,d)){
      if((c[k]||[]).includes(id)){cur++;longest=Math.max(longest,cur);}
      else cur=0;
    }
    d.setDate(d.getDate()+1);
  }
  return longest;
};

const habRate = (id, days=28) => {
  const c=habComp(); const h=habits.find(x=>x.id===id); if(!h) return 0;
  let done=0,sched=0,d=new Date(); d.setHours(0,0,0,0);
  for(let i=0;i<days;i++){
    const dd=new Date(d); dd.setDate(d.getDate()-i);
    if(habIsScheduled(h,dd)){sched++;if((c[habKey(dd)]||[]).includes(id))done++;}
  }
  return sched?Math.round((done/sched)*100):0;
};

const habToggle = (id, k) => {
  const c=habComp(); if(!c[k])c[k]=[];
  const idx=c[k].indexOf(id);
  if(idx>=0)c[k].splice(idx,1); else c[k].push(id);
  habSaveComp(c); habStreakCache={};
};

// ── Date strip ──────────────────────────────────────────────────────────────
const renderHabStrip = () => {
  const strip=document.getElementById('habDateStrip'); strip.innerHTML='';
  const today=new Date(); today.setHours(0,0,0,0);
  const c=habComp();
  const DAY_NAMES=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  for(let i=13;i>=0;i--){
    const d=new Date(today); d.setDate(today.getDate()-i+habStripOffset);
    const k=habKey(d);
    const isToday=d.toDateString()===today.toDateString();
    const isSel=k===habKey(habViewDate);
    const scheduled=habits.filter(h=>!h.archived&&habIsScheduled(h,d));
    const done=scheduled.filter(h=>(c[k]||[]).includes(h.id)).length;
    const btn=document.createElement('div');
    btn.className='hab-day-btn'+(isToday?' today':'')+(isSel?' selected':'');
    const dotHtml=scheduled.slice(0,6).map(h=>`<div class="hab-day-dot" style="width:4px;height:4px;border-radius:50%;background:${(c[k]||[]).includes(h.id)?h.color||'var(--green-b)':'var(--bg2)'}"></div>`).join('');
    btn.innerHTML=`<div class="hab-day-name">${DAY_NAMES[d.getDay()]}</div><div class="hab-day-num">${d.getDate()}</div><div class="hab-day-dots">${dotHtml}</div>`;
    btn.addEventListener('click',()=>{habViewDate=new Date(d);renderHabitsModal();});
    strip.appendChild(btn);
  }
};

// ── Ring progress ────────────────────────────────────────────────────────────
const updateHabRing = pct => {
  const fg=document.getElementById('habRingFg');
  const offset=HAB_CIRC*(1-pct/100);
  fg.style.strokeDashoffset=offset;
  fg.style.stroke=pct===100?'var(--yellow-b)':pct>=70?'var(--green-b)':pct>=40?'var(--yellow-b)':'var(--red-b)';
  document.getElementById('habRingPct').textContent=pct+'%';
  document.getElementById('habRingPct').style.color=pct===100?'var(--yellow-b)':pct>=70?'var(--green-b)':pct>=40?'var(--yellow-b)':'var(--red-b)';
};

// ── Today view ───────────────────────────────────────────────────────────────
const renderHabTodayView = () => {
  const dateKey=habKey(habViewDate);
  const c=habComp();
  const active=habits.filter(h=>!h.archived);
  const scheduled=active.filter(h=>habIsScheduled(h,habViewDate));
  const done=scheduled.filter(h=>(c[dateKey]||[]).includes(h.id)).length;
  const pct=scheduled.length?Math.round((done/scheduled.length)*100):0;
  updateHabRing(pct);

  // Summary chips
  const allStreaks=active.map(h=>habStreak(h.id));
  const maxStreak=allStreaks.length?Math.max(...allStreaks):0;
  const bestHab=active[allStreaks.indexOf(maxStreak)];
  const weekRate=active.length?Math.round(active.reduce((s,h)=>s+habRate(h.id,7),0)/Math.max(active.length,1)):0;
  document.getElementById('habSummaryRow').innerHTML=`
    <div class="hab-chip streak">🔥<span class="hab-chip-val">${maxStreak}</span>best streak${bestHab?'&thinsp;·&thinsp;'+bestHab.icon:''}
    </div>
    <div class="hab-chip done">✅<span class="hab-chip-val">${done}/${scheduled.length}</span>today</div>
    <div class="hab-chip total">📋<span class="hab-chip-val">${active.length}</span>habits</div>
    <div class="hab-chip rate">📈<span class="hab-chip-val">${weekRate}%</span>7-day avg</div>`;

  // Perfect day banner
  const bannerEl=document.getElementById('habPerfectBanner');
  if(pct===100&&scheduled.length>0){
    bannerEl.innerHTML='<div class="hab-perfect">🏆 PERFECT DAY! All habits complete!</div>';
  } else bannerEl.innerHTML='';

  // Progress bar
  document.getElementById('habProgFill').style.width=pct+'%';
  document.getElementById('habProgLeft').textContent=(scheduled.length-done)+' remaining';
  document.getElementById('habProgRight').textContent=done+' / '+scheduled.length;

  // Category filter pills
  const pillsEl=document.getElementById('habCatPills'); pillsEl.innerHTML='';
  const cats=['All',...new Set(active.map(h=>h.category||'General'))];
  cats.forEach(cat=>{
    const p=document.createElement('button');
    p.className='hab-cat-pill'+(habCatFilter===cat?' on':'');
    p.textContent=cat; p.addEventListener('click',()=>{habCatFilter=cat;renderHabTodayView();});
    pillsEl.appendChild(p);
  });

  // Filter + sort habits
  let filtered=scheduled.filter(h=>habCatFilter==='All'||(h.category||'General')===habCatFilter);
  if(habSort==='streak') filtered=[...filtered].sort((a,b)=>habStreak(b.id)-habStreak(a.id));
  else if(habSort==='name') filtered=[...filtered].sort((a,b)=>a.name.localeCompare(b.name));
  else if(habSort==='cat') filtered=[...filtered].sort((a,b)=>(a.category||'').localeCompare(b.category||''));
  else filtered=[...filtered].sort((a,b)=>(a.order||0)-(b.order||0));

  const list=document.getElementById('habList'); list.innerHTML='';
  if(!filtered.length){
    list.innerHTML=`<div class="hab-empty"><span class="hab-empty-icon">🌱</span>${habits.filter(h=>!h.archived).length?'No habits match this filter or day.':'No habits yet.<br>Add your first one below!'}</div>`;
  } else {
    filtered.forEach(h=>list.appendChild(buildHabItem(h, dateKey, c)));
  }

  // Archived section
  renderHabArchived();
};

const buildHabItem = (h, dateKey, c) => {
  const done=(c[dateKey]||[]).includes(h.id);
  const streak=habStreak(h.id);
  const col=h.color||'var(--green-b)';

  const item=document.createElement('div');
  item.className='hab-item'+(done?' done':'');
  item.dataset.id=h.id;
  item.style.borderLeftColor=done?col:'var(--bg3)';

  // 28-day history dots
  const dots28=[];
  const today=new Date(); today.setHours(0,0,0,0);
  for(let i=27;i>=0;i--){
    const dd=new Date(today); dd.setDate(today.getDate()-i);
    const k=habKey(dd);
    const sched=habIsScheduled(h,dd);
    const isDone=(c[k]||[]).includes(h.id);
    dots28.push({sched,isDone,col});
  }
  const dotsHtml=dots28.map(d=>{
    if(!d.sched) return `<div class="hab-28dot off" style="background:var(--bg2);opacity:.15"></div>`;
    return `<div class="hab-28dot ${d.isDone?'on':'off'}" style="background:${d.isDone?d.col:'var(--bg3)'}"></div>`;
  }).join('');

  const streakClass=streak>=30?'fire':streak>=14?'hot':streak>=7?'warm':streak>0?'cold':'cold';
  const recurLabel=h.recurrence==='weekdays'?'Weekdays':h.recurrence==='weekends'?'Weekends':h.recurrence==='custom'?'Custom':'Daily';

  item.innerHTML=`
    <div class="hab-grab" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>
    <div class="hab-check${done?' checked':''}">${done?'<i class="fas fa-check"></i>':''}</div>
    <div class="hab-icon-wrap">${h.icon||'📚'}</div>
    <div class="hab-body">
      <div class="hab-name">${h.name}</div>
      <div class="hab-meta-row">
        <span class="hab-cat-badge" style="background:${col}22;color:${col};">${h.category||'General'}</span>
        <span class="hab-recur-badge">${recurLabel}</span>
        ${h.reminder?`<span class="hab-reminder-badge">⏰ ${h.reminder}</span>`:''}
      </div>
      <div class="hab-28dots">${dotsHtml}</div>
    </div>
    <div class="hab-right">
      <div class="hab-streak-chip ${streakClass}">🔥 ${streak}</div>
      <div class="hab-item-btns">
        <button class="hab-icon-btn" data-action="edit" title="Edit"><i class="fas fa-pen"></i></button>
        <button class="hab-icon-btn" data-action="archive" title="Archive"><i class="fas fa-archive"></i></button>
      </div>
    </div>`;

  // Inline edit panel
  const editPanel=buildHabEditPanel(h);
  item.appendChild(editPanel);

  // Check toggle with bounce
  const checkEl=item.querySelector('.hab-check');
  checkEl.addEventListener('click',()=>{
    habToggle(h.id,dateKey);
    checkEl.classList.add('bounce');
    setTimeout(()=>checkEl.classList.remove('bounce'),300);
    setTimeout(()=>renderHabTodayView(),350);
  });

  // Action buttons
  item.querySelector('[data-action="edit"]').addEventListener('click',e=>{
    e.stopPropagation();
    const isOpen=editPanel.classList.contains('open');
    document.querySelectorAll('.hab-edit-panel.open').forEach(p=>p.classList.remove('open'));
    if(!isOpen) editPanel.classList.add('open');
  });

  item.querySelector('[data-action="archive"]').addEventListener('click',()=>{
    const hIdx=habits.findIndex(x=>x.id===h.id);
    if(hIdx>=0){habits[hIdx].archived=true;habSave();renderHabTodayView();}
  });

  // Drag to reorder
  item.setAttribute('draggable','true');
  item.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',h.id);item.classList.add('dragging-hab');});
  item.addEventListener('dragend',()=>item.classList.remove('dragging-hab'));
  item.addEventListener('dragover',e=>{e.preventDefault();item.classList.add('drag-over-hab');});
  item.addEventListener('dragleave',()=>item.classList.remove('drag-over-hab'));
  item.addEventListener('drop',e=>{
    e.preventDefault(); item.classList.remove('drag-over-hab');
    const srcId=e.dataTransfer.getData('text/plain');
    if(srcId===h.id) return;
    const srcIdx=habits.findIndex(x=>x.id===srcId);
    const dstIdx=habits.findIndex(x=>x.id===h.id);
    if(srcIdx<0||dstIdx<0) return;
    const [moved]=habits.splice(srcIdx,1); habits.splice(dstIdx,0,moved);
    habits.forEach((x,i)=>x.order=i); habSave(); renderHabTodayView();
  });

  return item;
};

// ── Inline edit panel ────────────────────────────────────────────────────────
const buildHabEditPanel = h => {
  const panel=document.createElement('div');
  panel.className='hab-edit-panel';

  const col=h.color||'#b8bb26';
  const recurVal=h.recurrence||'daily';
  const customDays=h.customDays||[0,1,2,3,4,5,6];
  const DAY_LBLS=['S','M','T','W','T','F','S'];

  panel.innerHTML=`
    <div class="hab-edit-row">
      <span class="hab-edit-label">NAME</span>
      <input class="hab-edit-input" id="heN_${h.id}" value="${h.name}" maxlength="50">
    </div>
    <div class="hab-edit-row">
      <span class="hab-edit-label">ICON</span>
      <div class="hab-emoji-grid-wrap" id="heEWrap_${h.id}">
        <button class="hab-emoji-btn" id="heEBtn_${h.id}" type="button">${h.icon||'📚'}</button>
        <div class="hab-emoji-grid" id="heEGrid_${h.id}" style="display:none"></div>
      </div>
    </div>
    <div class="hab-edit-row">
      <span class="hab-edit-label">COLOR</span>
      <div class="hab-color-swatches" id="heColors_${h.id}">
        ${HAB_COLORS.map(c=>`<div class="hab-color-sw${c===col?' on':''}" style="background:${c}" data-c="${c}"></div>`).join('')}
      </div>
    </div>
    <div class="hab-edit-row">
      <span class="hab-edit-label">CATEGORY</span>
      <select class="hab-add-cat" id="heCat_${h.id}">
        ${['General','Health','Fitness','Mind','Learning','Social','Creative'].map(cat=>`<option${cat===(h.category||'General')?' selected':''}>${cat}</option>`).join('')}
      </select>
    </div>
    <div class="hab-edit-row">
      <span class="hab-edit-label">REMINDER</span>
      <input class="hab-edit-time" id="heR_${h.id}" type="time" value="${h.reminder||''}">
    </div>
    <div class="hab-edit-row">
      <span class="hab-edit-label">RECURRENCE</span>
      <div class="hab-recur-pills" id="heRecur_${h.id}">
        ${['daily','weekdays','weekends','custom'].map(r=>`<button class="hab-recur-pill${recurVal===r?' on':''}" data-r="${r}">${r}</button>`).join('')}
      </div>
    </div>
    <div class="hab-edit-row" id="heCustomRow_${h.id}" style="${recurVal==='custom'?'':'display:none'}">
      <span class="hab-edit-label">DAYS</span>
      <div class="hab-day-toggles">
        ${DAY_LBLS.map((l,i)=>`<button class="hab-day-toggle${customDays.includes(i)?' on':''}" data-i="${i}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="hab-edit-row">
      <button class="hab-edit-save" id="heSave_${h.id}">SAVE CHANGES</button>
      <button class="hab-icon-btn danger" id="heDel_${h.id}" style="margin-left:8px;font-size:11px;"><i class="fas fa-trash"></i> DELETE</button>
    </div>`;

  // Emoji grid
  buildEmojiGrid(panel.querySelector(`#heEGrid_${h.id}`), btn => {
    panel.querySelector(`#heEBtn_${h.id}`).textContent=btn;
  });
  panel.querySelector(`#heEBtn_${h.id}`).addEventListener('click',e=>{
    e.stopPropagation();
    const grid=panel.querySelector(`#heEGrid_${h.id}`);
    grid.style.display=grid.style.display==='none'?'flex':'none';
  });

  // Color swatches
  let editColor=col;
  panel.querySelectorAll('.hab-color-sw').forEach(sw=>{
    sw.addEventListener('click',()=>{
      panel.querySelectorAll('.hab-color-sw').forEach(s=>s.classList.remove('on'));
      sw.classList.add('on'); editColor=sw.dataset.c;
    });
  });

  // Recurrence pills
  let editRecur=recurVal, editCustomDays=[...customDays];
  panel.querySelectorAll('.hab-recur-pill').forEach(p=>{
    p.addEventListener('click',()=>{
      panel.querySelectorAll('.hab-recur-pill').forEach(x=>x.classList.remove('on'));
      p.classList.add('on'); editRecur=p.dataset.r;
      panel.querySelector(`#heCustomRow_${h.id}`).style.display=editRecur==='custom'?'':'none';
    });
  });
  panel.querySelectorAll('.hab-day-toggle').forEach(t=>{
    t.addEventListener('click',()=>{
      const i=parseInt(t.dataset.i);
      const idx=editCustomDays.indexOf(i);
      if(idx>=0)editCustomDays.splice(idx,1); else editCustomDays.push(i);
      t.classList.toggle('on',editCustomDays.includes(i));
    });
  });

  // Save
  panel.querySelector(`#heSave_${h.id}`).addEventListener('click',()=>{
    const idx=habits.findIndex(x=>x.id===h.id); if(idx<0) return;
    habits[idx].name=panel.querySelector(`#heN_${h.id}`).value.trim()||h.name;
    habits[idx].icon=panel.querySelector(`#heEBtn_${h.id}`).textContent.trim();
    habits[idx].color=editColor;
    habits[idx].category=panel.querySelector(`#heCat_${h.id}`).value;
    habits[idx].reminder=panel.querySelector(`#heR_${h.id}`).value;
    habits[idx].recurrence=editRecur;
    habits[idx].customDays=editCustomDays;
    habSave(); panel.classList.remove('open'); renderHabTodayView();
  });

  // Delete (with custom confirm via alert modal)
  panel.querySelector(`#heDel_${h.id}`).addEventListener('click',()=>{
    showAlert(`Delete "${h.name}" permanently?`, ok=>{
      if(!ok) return;
      habits=habits.filter(x=>x.id!==h.id); habSave(); renderHabTodayView();
    });
  });

  return panel;
};

// ── Emoji grid helper ────────────────────────────────────────────────────────
const buildEmojiGrid = (gridEl, onPick) => {
  HAB_EMOJIS.forEach(e=>{
    const btn=document.createElement('div');
    btn.className='hab-emoji-grid-item'; btn.textContent=e;
    btn.addEventListener('click',ev=>{ev.stopPropagation();onPick(e);gridEl.style.display='none';});
    gridEl.appendChild(btn);
  });
};

// ── Archived section ─────────────────────────────────────────────────────────
const renderHabArchived = () => {
  const sec=document.getElementById('habArchivedSection'); sec.innerHTML='';
  const archived=habits.filter(h=>h.archived);
  if(!archived.length) return;
  const title=document.createElement('div');
  title.className='hab-archived-title';
  title.innerHTML=`${habShowArchived?'▾':'▸'} ARCHIVED (${archived.length})`;
  title.addEventListener('click',()=>{habShowArchived=!habShowArchived;renderHabArchived();});
  sec.appendChild(title);
  if(!habShowArchived) return;
  archived.forEach(h=>{
    const row=document.createElement('div'); row.className='hab-arch-item';
    row.innerHTML=`<span>${h.icon||'📚'}</span><span style="font-size:12px">${h.name}</span><button class="hab-arch-restore">RESTORE</button>`;
    row.querySelector('.hab-arch-restore').addEventListener('click',()=>{
      const idx=habits.findIndex(x=>x.id===h.id);
      if(idx>=0){habits[idx].archived=false;habSave();renderHabTodayView();}
    });
    sec.appendChild(row);
  });
};

// ── Calendar view ────────────────────────────────────────────────────────────
// ── Stats view ───────────────────────────────────────────────────────────────
const renderHabStatsView = () => {
  const el = document.getElementById('habStatsView');
  el.innerHTML = '';
  const active = habits.filter(h => !h.archived);
  if (!active.length) { el.innerHTML='<div class="hab-empty"><span class="hab-empty-icon">📊</span>No habits yet.</div>'; return; }
  const c = habComp();
  const today = new Date(); today.setHours(0,0,0,0);
  const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const allStreaks = active.map(h=>habStreak(h.id));
  const allLongest = active.map(h=>habLongestStreak(h.id));
  const allR28 = active.map(h=>habRate(h.id,28));
  const allR7  = active.map(h=>habRate(h.id,7));
  const allTot = active.map(h=>{ let n=0; Object.values(c).forEach(ids=>{if(ids.includes(h.id))n++;}); return n; });
  const maxS   = Math.max(...allStreaks,0);
  const maxL   = Math.max(...allLongest,0);
  const avgR28 = active.length ? Math.round(allR28.reduce((s,r)=>s+r,0)/active.length) : 0;
  const totAll = allTot.reduce((s,n)=>s+n,0);
  let perf=0;
  for(let i=0;i<30;i++){
    const d=new Date(today); d.setDate(today.getDate()-i); const k=habKey(d);
    const sc=active.filter(h=>habIsScheduled(h,d));
    if(sc.length&&sc.every(h=>(c[k]||[]).includes(h.id)))perf++;
  }
  const dowDone=new Array(7).fill(0), dowSch=new Array(7).fill(0);
  for(let i=0;i<90;i++){
    const d=new Date(today); d.setDate(today.getDate()-i);
    const k=habKey(d),dow=d.getDay();
    active.forEach(h=>{ if(habIsScheduled(h,d)){ dowSch[dow]++; if((c[k]||[]).includes(h.id))dowDone[dow]++; } });
  }
  const dowR=dowSch.map((s,i)=>s?Math.round(dowDone[i]/s*100):0);
  const maxDR=Math.max(...dowR,1);
  const bestDow=dowR.indexOf(Math.max(...dowR));
  const worstDow=dowR.reduce((b,r,i)=>(dowSch[i]>0&&r<dowR[b]?i:b),bestDow);

  // ── Overview ──────────────────────────────────────────────────────────
  const mkSec = title => { const s=document.createElement('div'); s.className='hab-stats-section'; s.innerHTML=`<div class="hab-stats-section-title">${title}</div>`; el.appendChild(s); return s; };
  const sec1=mkSec('OVERVIEW');
  const g=document.createElement('div'); g.className='hab-stats-grid';
  g.innerHTML=`
    <div class="hab-stat-card"><div class="hab-stat-card-icon">🔥</div><div class="hab-stat-val" style="color:#fe8019">${maxS}</div><div class="hab-stat-lbl">BEST STREAK</div><div class="hab-stat-sub">current</div></div>
    <div class="hab-stat-card"><div class="hab-stat-card-icon">🏆</div><div class="hab-stat-val" style="color:var(--yellow-b)">${maxL}</div><div class="hab-stat-lbl">LONGEST EVER</div><div class="hab-stat-sub">all time</div></div>
    <div class="hab-stat-card"><div class="hab-stat-card-icon">✅</div><div class="hab-stat-val" style="color:var(--green-b)">${avgR28}%</div><div class="hab-stat-lbl">AVG COMPLETION</div><div class="hab-stat-sub">last 28 days</div></div>
    <div class="hab-stat-card"><div class="hab-stat-card-icon">⭐</div><div class="hab-stat-val" style="color:var(--yellow-b)">${perf}</div><div class="hab-stat-lbl">PERFECT DAYS</div><div class="hab-stat-sub">last 30 days</div></div>
    <div class="hab-stat-card"><div class="hab-stat-card-icon">📦</div><div class="hab-stat-val" style="color:var(--blue-b)">${totAll}</div><div class="hab-stat-lbl">TOTAL COMPLETIONS</div><div class="hab-stat-sub">all time</div></div>
    <div class="hab-stat-card"><div class="hab-stat-card-icon">📋</div><div class="hab-stat-val" style="color:var(--fg)">${active.length}</div><div class="hab-stat-lbl">ACTIVE HABITS</div><div class="hab-stat-sub">tracked now</div></div>`;
  sec1.appendChild(g);

  // ── Day of week ───────────────────────────────────────────────────────
  const sec2=mkSec('COMPLETION BY DAY OF WEEK (last 90 days)');
  const dg=document.createElement('div'); dg.className='hab-dow-grid';
  dowR.forEach((rate,i)=>{
    const col2=document.createElement('div'); col2.className='hab-dow-col';
    const bh=Math.max(2,Math.round((rate/maxDR)*48));
    const bc=rate>=80?'var(--green-b)':rate>=60?'var(--yellow-b)':rate>=40?'#fe8019':'var(--red-b)';
    col2.innerHTML=`<div class="hab-dow-bar-wrap"><div class="hab-dow-bar" style="height:${bh}px;background:${i===bestDow?bc:bc+'88'}"></div></div>
      <div class="hab-dow-lbl" style="font-weight:${i===bestDow?700:400};color:${i===bestDow?'var(--fg)':'var(--fg-dim)'}">${DNAMES[i][0]}</div>
      <div class="hab-dow-pct">${rate}%</div>`;
    dg.appendChild(col2);
  });
  sec2.appendChild(dg);

  // ── Streak leaderboard ────────────────────────────────────────────────
  const sec3=mkSec('STREAK LEADERBOARD');
  const lb=document.createElement('div'); lb.className='hab-leaderboard';
  [...active].map((h,i)=>({h,s:allStreaks[i],l:allLongest[i],r:allR28[i]}))
    .sort((a,b)=>b.s-a.s).slice(0,5).forEach(({h,s,l,r},i)=>{
      const col3=h.color||'var(--green-b)';
      const row=document.createElement('div'); row.className='hab-lb-row';
      row.style.cssText=`border-left:3px solid ${col3};`;
      row.innerHTML=`<div class="hab-lb-medal">${['🥇','🥈','🥉','4️⃣','5️⃣'][i]||''}</div>
        <div class="hab-lb-icon">${h.icon||'📚'}</div>
        <div class="hab-lb-info"><div class="hab-lb-name" style="color:${col3}">${h.name}</div>
        <div class="hab-lb-meta">Best ever: ${l}d · 28-day: ${r}% · ${h.category||'General'}</div></div>
        <div class="hab-lb-streak">🔥${s}</div>`;
      lb.appendChild(row);
    });
  sec3.appendChild(lb);

  // ── Insights ──────────────────────────────────────────────────────────
  const sec4=mkSec('INSIGHTS');
  const ins=[];
  const bh2=active[allR28.indexOf(Math.max(...allR28))];
  const wh=active[allR28.indexOf(Math.min(...allR28))];
  const mth=active[allTot.indexOf(Math.max(...allTot))];
  if(bh2) ins.push({icon:'🌟',t:`<strong>${bh2.icon} ${bh2.name}</strong> is your most consistent — <strong>${Math.max(...allR28)}%</strong> over 28 days.`});
  if(wh&&wh.id!==bh2?.id) ins.push({icon:'⚠️',t:`<strong>${wh.icon} ${wh.name}</strong> needs attention — only <strong>${Math.min(...allR28)}%</strong> completion. Try a reminder or easier target.`});
  if(bestDow>=0) ins.push({icon:'📅',t:`You're most productive on <strong>${DNAMES[bestDow]}s</strong> (${dowR[bestDow]}%). Schedule your hardest habits then.`});
  if(worstDow>=0&&worstDow!==bestDow&&dowSch[worstDow]>0) ins.push({icon:'😴',t:`<strong>${DNAMES[worstDow]}s</strong> are your weakest (${dowR[worstDow]}%). Try lighter habits or extra reminders.`});
  if(mth) ins.push({icon:'🏅',t:`<strong>${mth.icon} ${mth.name}</strong> is your all-time champion — completed <strong>${Math.max(...allTot)}</strong> times.`});
  if(perf>=5) ins.push({icon:'🔥',t:`<strong>${perf} perfect days</strong> in the last 30. Exceptional consistency!`});
  else if(perf===0) ins.push({icon:'💡',t:`No perfect days yet — try completing all scheduled habits in one day to start the momentum.`});
  const il=document.createElement('div'); il.className='hab-insight-list';
  ins.slice(0,5).forEach(({icon,t})=>{
    const d=document.createElement('div'); d.className='hab-insight';
    d.innerHTML=`<div class="hab-insight-icon">${icon}</div><div class="hab-insight-text">${t}</div>`;
    il.appendChild(d);
  });
  sec4.appendChild(il);

  // ── Per-habit breakdown ───────────────────────────────────────────────
  const sec5=mkSec('PER-HABIT BREAKDOWN');
  const pl=document.createElement('div'); pl.className='hab-per-hab-list';
  [...active].map((h,i)=>({h,s:allStreaks[i],l:allLongest[i],r28:allR28[i],r7:allR7[i],tot:allTot[i]}))
    .sort((a,b)=>b.r28-a.r28).forEach(({h,s,l,r28,r7,tot})=>{
      const col4=h.color||'var(--green-b)';
      let ld=null;
      for(let i=0;i<365;i++){const d=new Date(today);d.setDate(today.getDate()-i);if((c[habKey(d)]||[]).includes(h.id)){ld=d;break;}}
      const ls=ld?(ld.toDateString()===today.toDateString()?'Today':ld.toLocaleDateString('en-US',{month:'short',day:'numeric'})):'Never';
      const sc2=s>=30?'fire':s>=14?'hot':s>=7?'warm':'cold';
      const card=document.createElement('div'); card.className='hab-per-row';
      card.style.cssText=`border-left:3px solid ${col4};`;
      card.innerHTML=`
        <div class="hab-per-top">
          <div class="hab-per-icon">${h.icon||'📚'}</div>
          <div class="hab-per-name" style="color:${col4}">${h.name}</div>
          <div class="hab-per-chips">
            <span class="hab-per-chip" style="background:${col4}22;color:${col4}">${h.category||'General'}</span>
            <span class="hab-streak-chip ${sc2}">🔥 ${s}</span>
          </div>
        </div>
        <div class="hab-per-bar-row">
          <div class="hab-per-bar-lbl">7-day</div>
          <div class="hab-per-bar-track"><div class="hab-per-bar-fill" style="width:${r7}%;background:${col4}"></div></div>
          <div class="hab-per-bar-val">${r7}%</div>
        </div>
        <div class="hab-per-bar-row">
          <div class="hab-per-bar-lbl">28-day</div>
          <div class="hab-per-bar-track"><div class="hab-per-bar-fill" style="width:${r28}%;background:${col4}88"></div></div>
          <div class="hab-per-bar-val">${r28}%</div>
        </div>
        <div class="hab-per-bar-row">
          <div class="hab-per-bar-lbl">Best</div>
          <div class="hab-per-bar-track"><div class="hab-per-bar-fill" style="width:${maxL>0?Math.min(l/maxL*100,100):0}%;background:${col4}44"></div></div>
          <div class="hab-per-bar-val">${l}d</div>
        </div>
        <div class="hab-per-last">Last: ${ls} · ${tot} total completions</div>`;
      pl.appendChild(card);
    });
  sec5.appendChild(pl);
};

// ── Main render ──────────────────────────────────────────────────────────────
const renderHabitsModal = () => {
  renderHabStrip();
  document.getElementById('habTodayView').style.display  = habView==='today'    ? '' : 'none';
  document.getElementById('habStatsView').style.display  = habView==='stats'    ? '' : 'none';
  if(habView==='today')    renderHabTodayView();
  if(habView==='stats')    renderHabStatsView();
};

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.getElementById('habTabs').addEventListener('click',e=>{
  const btn=e.target.closest('.hab-tab'); if(!btn) return;
  document.querySelectorAll('.hab-tab').forEach(t=>t.classList.remove('on'));
  btn.classList.add('on'); habView=btn.dataset.view; renderHabitsModal();
});

// ── Date nav arrows ───────────────────────────────────────────────────────────
document.getElementById('habDateBack').addEventListener('click',()=>{habStripOffset-=7;renderHabStrip();});
document.getElementById('habDateFwd').addEventListener('click',()=>{habStripOffset=Math.min(0,habStripOffset+7);renderHabStrip();});
document.getElementById('habDateToday').addEventListener('click',()=>{habStripOffset=0;habViewDate=new Date();renderHabitsModal();});

// ── Sort ─────────────────────────────────────────────────────────────────────
document.getElementById('habSortSel').addEventListener('change',e=>{habSort=e.target.value;renderHabTodayView();});

// ── Add habit ────────────────────────────────────────────────────────────────
// Emoji picker for add form
buildEmojiGrid(document.getElementById('habAddEmojiGrid'), icon=>{
  habAddIcon=icon;
  document.getElementById('habAddEmojiBtn').textContent=icon;
  document.getElementById('habAddEmojiGrid').style.display='none';
});
document.getElementById('habAddEmojiBtn').addEventListener('click',e=>{
  e.stopPropagation();
  const grid=document.getElementById('habAddEmojiGrid');
  grid.style.display=grid.style.display==='none'?'flex':'none';
});

// Color swatches for add form
const addColorsEl=document.getElementById('habAddColors');
HAB_COLORS.forEach(c=>{
  const sw=document.createElement('div');
  sw.className='hab-color-sw'+(c===habAddColor?' on':'');
  sw.style.background=c; sw.dataset.c=c;
  sw.addEventListener('click',()=>{
    addColorsEl.querySelectorAll('.hab-color-sw').forEach(s=>s.classList.remove('on'));
    sw.classList.add('on'); habAddColor=c;
  });
  addColorsEl.appendChild(sw);
});

// Recurrence pills for add form
const addRecurEl=document.getElementById('habAddRecurPills');
['daily','weekdays','weekends','custom'].forEach(r=>{
  const p=document.createElement('button');
  p.className='hab-recur-pill'+(habAddRecur===r?' on':'');
  p.textContent=r; p.dataset.r=r;
  p.addEventListener('click',()=>{
    addRecurEl.querySelectorAll('.hab-recur-pill').forEach(x=>x.classList.remove('on'));
    p.classList.add('on'); habAddRecur=r;
    document.getElementById('habAddDayToggles').style.display=r==='custom'?'flex':'none';
  });
  addRecurEl.appendChild(p);
});

// Day toggles for add form
const addDaysEl=document.getElementById('habAddDayToggles');
const DAY_LBLS2=['S','M','T','W','T','F','S'];
DAY_LBLS2.forEach((l,i)=>{
  const btn=document.createElement('button');
  btn.className='hab-day-toggle'+(habAddCustomDays.includes(i)?' on':'');
  btn.textContent=l; btn.dataset.i=i;
  btn.addEventListener('click',()=>{
    const idx=habAddCustomDays.indexOf(i);
    if(idx>=0)habAddCustomDays.splice(idx,1); else habAddCustomDays.push(i);
    btn.classList.toggle('on',habAddCustomDays.includes(i));
  });
  addDaysEl.appendChild(btn);
});

document.getElementById('habAddSubmit').addEventListener('click',()=>{
  const name=document.getElementById('habAddName').value.trim();
  if(!name){document.getElementById('habAddName').focus();return;}
  const habit={
    id:uid(), name, icon:habAddIcon, color:habAddColor,
    category:document.getElementById('habAddCat').value,
    reminder:document.getElementById('habAddTime').value,
    recurrence:habAddRecur, customDays:[...habAddCustomDays],
    createdAt:new Date().toISOString(), archived:false,
    order:habits.length
  };
  habits.push(habit); habSave();
  document.getElementById('habAddName').value='';
  renderHabitsModal();
});

document.getElementById('habAddName').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('habAddSubmit').click();
});

// Close emoji grid on outside click
document.addEventListener('click',e=>{
  if(!e.target.closest('.hab-emoji-grid-wrap')){
    document.querySelectorAll('.hab-emoji-grid').forEach(g=>g.style.display='none');
  }
});

document.getElementById('openHabitsBtn').addEventListener('click',()=>{
  habViewDate=new Date(); habView='today'; habStreakCache={};
  document.querySelectorAll('.hab-tab').forEach(t=>t.classList.toggle('on',t.dataset.view==='today'));
  renderHabitsModal(); openM('habitsModal');
});

// ── Notifications ─────────────────────────────────────────────────────────────

// === DAY TIMELINE ===
let tlnViewDate = new Date();
let tlnView = 'timeline';

const tlnFmtTime = dt => {
  const d = new Date(dt);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
};
const tlnDurFmt = ms => {
  const m = Math.round(ms/60000);
  return m < 60 ? m + 'm' : Math.floor(m/60) + 'h ' + (m%60) + 'm';
};

const tlnDayEntries = date => {
  const start = new Date(date); start.setHours(0,0,0,0);
  const end = new Date(date); end.setHours(23,59,59,999);
  return timeEntries
    .filter(e => e.startTime && e.endTime && new Date(e.startTime) >= start && new Date(e.startTime) <= end)
    .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
};

const tlnFindGaps = entries => {
  const gaps = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const gapMs = new Date(entries[i+1].startTime) - new Date(entries[i].endTime);
    if (gapMs >= 20 * 60000) {
      gaps.push({ startTime: entries[i].endTime, endTime: entries[i+1].startTime, durationMs: gapMs, task: 'Idle gap', isIdle: true });
    }
  }
  return gaps;
};

const renderTimeline = () => {
  const entries = tlnDayEntries(tlnViewDate);
  const allItems = [...entries, ...tlnFindGaps(entries)].sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const totalMs = entries.reduce((s,e)=>s+e.durationMs,0);
  const totalSec = Math.round(totalMs/1000);

  document.getElementById('tlnDateLbl').textContent = tlnViewDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

  // Stats
  const earliestE = entries[0];
  const latestE = entries[entries.length-1];
  document.getElementById('tlnStats').innerHTML = `
    <div class="tln-stat"><span class="tln-stat-val">${entries.length}</span>&nbsp;sessions</div>
    <div class="tln-stat"><span class="tln-stat-val">${fmtHuman(totalSec)}</span>&nbsp;tracked</div>
    ${earliestE ? `<div class="tln-stat"><span class="tln-stat-val">${tlnFmtTime(earliestE.startTime)}</span>&nbsp;first focus</div>` : ''}
    ${latestE ? `<div class="tln-stat"><span class="tln-stat-val">${tlnFmtTime(latestE.endTime)}</span>&nbsp;last stop</div>` : ''}
    <div class="tln-stat"><span class="tln-stat-val">${tlnFindGaps(entries).length}</span>&nbsp;idle gaps</div>`;

  const wrap = document.getElementById('tlnWrap'); wrap.innerHTML = '';

  if (!allItems.length) {
    wrap.innerHTML = '<div class="tln-empty">// no activity recorded for this day</div>';
    return;
  }

  if (tlnView === 'timeline') {
    const line = document.createElement('div'); line.className = 'tln-line';
    allItems.forEach(item => {
      const col = projColor(item.projectId);
      const slot = document.createElement('div'); slot.className = 'tln-slot';
      slot.innerHTML = `
        <div class="tln-time">${tlnFmtTime(item.startTime)}</div>
        <div class="tln-gutter"><div class="tln-dot" style="background:${item.isIdle ? 'var(--bg3)' : col}"></div></div>
        <div class="tln-block-wrap">
          <div class="tln-block ${item.isIdle ? 'idle' : 'entry'}" style="${item.isIdle ? '' : 'background:'+col+'22;'}">
            <div class="tln-block-title">${item.task || item.projectName || 'Focus'}</div>
            <div class="tln-block-meta">${tlnFmtTime(item.startTime)} → ${tlnFmtTime(item.endTime)} · ${tlnDurFmt(item.durationMs)}${item.projectName && !item.isIdle ? ' · '+item.projectName : ''}</div>
          </div>
        </div>`;
      line.appendChild(slot);
    });
    wrap.appendChild(line);

  } else if (tlnView === 'blocks') {
    if (!entries.length) { wrap.innerHTML = '<div class="tln-empty">// no entries for this day</div>'; return; }
    const dayStart = new Date(entries[0].startTime); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart); dayEnd.setHours(23,59,59,999);
    const dayMs = dayEnd - dayStart;
    const bv = document.createElement('div'); bv.className = 'tln-blocks-view';
    entries.forEach(e => {
      const left = ((new Date(e.startTime) - dayStart) / dayMs) * 100;
      const width = Math.max(0.4, (e.durationMs / dayMs) * 100);
      const col = projColor(e.projectId);
      const b = document.createElement('div'); b.className = 'tln-bv-block';
      b.style.cssText = `left:${left}%;width:${width}%;background:${col};color:var(--bg);`;
      b.textContent = width > 5 ? (e.task || 'Focus') : '';
      b.title = `${e.task || 'Focus'} · ${tlnFmtTime(e.startTime)}–${tlnFmtTime(e.endTime)} · ${tlnDurFmt(e.durationMs)}`;
      bv.appendChild(b);
    });
    wrap.appendChild(bv);
    // Hour axis
    const axis = document.createElement('div'); axis.className = 'tln-density-labels';
    axis.style.marginTop = '4px';
    for (let h = 0; h <= 23; h += 3) axis.innerHTML += `<span>${String(h).padStart(2,'0')}:00</span>`;
    wrap.appendChild(axis);

  } else { // density
    const hourMs = new Array(24).fill(0);
    entries.forEach(e => {
      const startH = new Date(e.startTime).getHours();
      const endH = new Date(e.endTime).getHours();
      for (let h = startH; h <= endH; h++) hourMs[h] += e.durationMs / Math.max(1, endH - startH + 1);
    });
    const maxH = Math.max(...hourMs, 1);
    const graph = document.createElement('div'); graph.className = 'tln-density';
    hourMs.forEach((ms, h) => {
      const bar = document.createElement('div'); bar.className = 'tln-density-bar';
      const pct = Math.round((ms/maxH)*100);
      bar.style.cssText = `height:${Math.max(2,pct)}%;background:rgba(131,165,152,${0.2 + pct/100 * 0.8});`;
      bar.title = `${String(h).padStart(2,'0')}:00 · ${tlnDurFmt(ms)}`;
      graph.appendChild(bar);
    });
    wrap.appendChild(graph);
    const labels = document.createElement('div'); labels.className = 'tln-density-labels';
    for (let h = 0; h <= 23; h += 4) labels.innerHTML += `<span>${String(h).padStart(2,'0')}:00</span>`;
    wrap.appendChild(labels);
  }
};

document.getElementById('tlnTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tln-tab'); if (!btn) return;
  document.querySelectorAll('.tln-tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on'); tlnView = btn.dataset.view; renderTimeline();
});
document.getElementById('tlnPrev').addEventListener('click', () => { tlnViewDate.setDate(tlnViewDate.getDate()-1); renderTimeline(); });
document.getElementById('tlnNext').addEventListener('click', () => { tlnViewDate.setDate(tlnViewDate.getDate()+1); renderTimeline(); });
document.getElementById('tlnToday').addEventListener('click', () => { tlnViewDate = new Date(); renderTimeline(); });

document.getElementById('openTimelineBtn').addEventListener('click', () => {
  tlnViewDate = new Date(viewDate); tlnView = 'timeline';
  document.querySelectorAll('.tln-tab').forEach(t => t.classList.toggle('on', t.dataset.view === 'timeline'));
  renderTimeline(); openM('timelineModal');
});


// === COMMAND PALETTE ===
const CMD_PALETTE = [
  { group:'TIMER', icon:'▶', iconBg:'rgba(251,73,52,.2)', label:'Start Pomodoro', desc:'Begin a focus session', action:() => { if(!pomoRunning) $('playBtn').click(); } },
  { group:'TIMER', icon:'⏸', iconBg:'rgba(251,73,52,.2)', label:'Pause / Resume', desc:'Toggle the current timer', action:() => $('playBtn').click() },
  { group:'TIMER', icon:'↺', iconBg:'rgba(251,73,52,.2)', label:'Reset Timer', desc:'Reset to start of current mode', action:() => $('resetBtn').click() },
  { group:'TIMER', icon:'⏭', iconBg:'rgba(251,73,52,.2)', label:'Skip to Next', desc:'Skip current session or break', action:() => $('skipBtn').click() },
  { group:'NAVIGATE', icon:'📅', iconBg:'rgba(131,165,152,.2)', label:'Jump to Today', desc:'Go to today\'s entries', action:() => { viewDate = new Date(); rerender(); } },
  { group:'NAVIGATE', icon:'🔥', iconBg:'rgba(250,189,47,.2)', label:'Focus Heatmap', desc:'Open streak analytics', action:() => $('openHeatmapBtn').click() },
  { group:'NAVIGATE', icon:'✅', iconBg:'rgba(152,151,26,.2)', label:'Habits & Routines', desc:'Open habit tracker', action:() => $('openHabitsBtn').click() },
  { group:'NAVIGATE', icon:'⏱', iconBg:'rgba(131,165,152,.2)', label:'Day Timeline', desc:'Replay your day', action:() => $('openTimelineBtn').click() },
  { group:'NAVIGATE', icon:'📊', iconBg:'rgba(177,98,134,.2)', label:'Advanced Reports', desc:'Open reports modal', action:() => $('openReportBtn').click() },
  { group:'CREATE', icon:'＋', iconBg:'rgba(152,151,26,.2)', label:'New Goal', desc:'Create a new goal', action:() => $('openGoalBtn').click() },
  { group:'CREATE', icon:'＋', iconBg:'rgba(131,165,152,.2)', label:'New Project', desc:'Create a new project', action:() => $('openProjBtn').click() },
  { group:'CREATE', icon:'💡', iconBg:'rgba(250,189,47,.2)', label:'New Habit', desc:'Add a habit to track', action:() => { $('openHabitsBtn').click(); setTimeout(()=>document.getElementById('habNameInput').focus(),300); } },
  { group:'DATA', icon:'⬇', iconBg:'rgba(168,153,132,.2)', label:'Export Data', desc:'Export all data as JSON', action:() => $('openExportBtn').click() },
  { group:'DATA', icon:'⬆', iconBg:'rgba(69,133,136,.2)', label:'Import Data', desc:'Import a backup JSON', action:() => $('openImportBtn').click() },
  { group:'DATA', icon:'🔍', iconBg:'rgba(250,189,47,.2)', label:'Settings', desc:'Open timer settings', action:() => $('pomoSettingsBtn').click() },
];

const cmdOverlay = document.getElementById('cmdOverlay');
const cmdInput   = document.getElementById('cmdInput');
const cmdResults = document.getElementById('cmdResults');
let cmdActive = -1, cmdFiltered = [];

const cmdScore = (item, q) => {
  if (!q) return 1;
  const hay = (item.label + ' ' + item.desc + ' ' + item.group).toLowerCase();
  const needle = q.toLowerCase();
  if (hay.startsWith(needle)) return 3;
  if (hay.includes(needle)) return 2;
  // fuzzy: every char of needle must appear in order
  let hi = 0;
  for (const ch of needle) { const idx = hay.indexOf(ch, hi); if (idx < 0) return 0; hi = idx+1; }
  return 1;
};

const renderCmdResults = q => {
  cmdFiltered = CMD_PALETTE
    .map(item => ({ item, score: cmdScore(item, q) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .map(x => x.item);
  cmdActive = cmdFiltered.length ? 0 : -1;
  cmdResults.innerHTML = '';
  let lastGroup = null;
  cmdFiltered.forEach((item, i) => {
    if (item.group !== lastGroup) {
      const g = document.createElement('div'); g.className = 'cmd-group'; g.textContent = item.group;
      cmdResults.appendChild(g); lastGroup = item.group;
    }
    const el = document.createElement('div');
    el.className = 'cmd-item' + (i === 0 ? ' active' : '');
    el.dataset.idx = i;
    el.innerHTML = `
      <div class="cmd-item-icon" style="background:${item.iconBg}">${item.icon}</div>
      <div class="cmd-item-text">
        <div class="cmd-item-label">${item.label}</div>
        <div class="cmd-item-desc">${item.desc}</div>
      </div>`;
    el.addEventListener('mouseenter', () => cmdSetActive(i));
    el.addEventListener('click', () => { cmdRun(i); });
    cmdResults.appendChild(el);
  });
};

const cmdSetActive = i => {
  cmdActive = i;
  cmdResults.querySelectorAll('.cmd-item').forEach((el,j) => el.classList.toggle('active', j === i));
  const el = cmdResults.querySelector(`.cmd-item[data-idx="${i}"]`);
  if (el) el.scrollIntoView({ block:'nearest' });
};

const cmdRun = i => {
  const item = cmdFiltered[i]; if (!item) return;
  cmdClose(); item.action();
};

const cmdOpen = () => {
  cmdOverlay.classList.add('open');
  cmdInput.value = ''; renderCmdResults(''); cmdInput.focus();
};
const cmdClose = () => cmdOverlay.classList.remove('open');

cmdInput.addEventListener('input', () => renderCmdResults(cmdInput.value.trim()));
cmdInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown')  { e.preventDefault(); cmdSetActive(Math.min(cmdActive+1, cmdFiltered.length-1)); }
  if (e.key === 'ArrowUp')    { e.preventDefault(); cmdSetActive(Math.max(cmdActive-1, 0)); }
  if (e.key === 'Enter')      { e.preventDefault(); cmdRun(cmdActive); }
  if (e.key === 'Escape')     { e.preventDefault(); cmdClose(); }
});
cmdOverlay.addEventListener('click', e => { if (e.target === cmdOverlay) cmdClose(); });

// Ctrl+K / Cmd+K global hotkey
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); cmdOverlay.classList.contains('open') ? cmdClose() : cmdOpen(); }
  if (e.key === 'Escape' && cmdOverlay.classList.contains('open')) cmdClose();
});

// === CLOCK ===
let hwState = JSON.parse(localStorage.getItem('hwState') || 'null') || { is24h: true, lat: null, lon: null, city: null };
const saveHwState = () => localStorage.setItem('hwState', JSON.stringify(hwState));

const hwClockEl = $('hwClock');
const pad = v => String(v).padStart(2, '0');
const tickClock = () => {
  const n = new Date();
  if (hwState.is24h) {
    hwClockEl.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
  } else {
    const h = n.getHours(), ampm = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    hwClockEl.textContent = `${pad(h12)}:${pad(n.getMinutes())}:${pad(n.getSeconds())} ${ampm}`;
  }
};
tickClock();
setInterval(tickClock, 1000);

$('hwClockChip').addEventListener('click', () => {
  hwState.is24h = !hwState.is24h;
  saveHwState();
  tickClock();
});

// === WEATHER ===
const WMO_ICON = code => {
  if (code === 0)  return ['fa-sun',                  'clear',  'CLEAR'];
  if (code <= 3)   return ['fa-cloud-sun',            'cloud',  'CLOUDY'];
  if (code <= 48)  return ['fa-smog',                 'fog',    'FOGGY'];
  if (code <= 55)  return ['fa-cloud-drizzle',        'rain',   'DRIZZLE'];
  if (code <= 67)  return ['fa-cloud-rain',           'rain',   'RAIN'];
  if (code <= 77)  return ['fa-snowflake',            'snow',   'SNOW'];
  if (code <= 82)  return ['fa-cloud-showers-heavy',  'rain',   'SHOWERS'];
  if (code <= 86)  return ['fa-snowflake',            'snow',   'SNOW'];
  return                  ['fa-cloud-bolt',           'storm',  'STORM'];
};

const applyWeatherData = d => {
  const c = d.current;
  const [icon, cls, label] = WMO_ICON(c.weather_code);
  $('hwIcon').className    = `hw-icon fas fa-${icon} ${cls}`;
  $('hwTemp').textContent  = `${Math.round(c.temperature_2m)}°C`;
  $('hwHumidity').textContent = `${c.relative_humidity_2m}%`;
  $('hwCond').textContent  = label;
};

const fetchWeather = (lat, lon) =>
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&temperature_unit=celsius&timezone=auto`)
    .then(r => r.json()).then(applyWeatherData)
    .catch(() => { $('hwIcon').className = 'hw-icon fas fa-triangle-exclamation loading'; $('hwCond').textContent = 'ERR'; });

const reverseGeocode = (lat, lon) =>
  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
    .then(r => r.json())
    .then(d => { const a = d.address; return a.city || a.town || a.village || a.county || a.state || 'Unknown'; });

const setLocation = (lat, lon, city) => {
  hwState.lat = lat; hwState.lon = lon; hwState.city = city;
  saveHwState();
  $('hwCity').textContent = city;
  fetchWeather(lat, lon);
};

// ── Location picker ────────────────────────────────────────────────────────
let hwPickerOpen = false, hwSearchTimeout = null;

const closeLocPicker = () => {
  hwPickerOpen = false;
  const p = document.getElementById('hwPicker');
  if (p) p.remove();
  document.removeEventListener('click', hwOutside);
};

const hwOutside = e => { if (!$('hwWeatherChip').contains(e.target)) closeLocPicker(); };

const openLocPicker = () => {
  if (hwPickerOpen) { closeLocPicker(); return; }
  hwPickerOpen = true;

  const picker = document.createElement('div');
  picker.id = 'hwPicker';
  picker.className = 'hw-picker';
  picker.innerHTML =
    `<input class="hw-search" id="hwSearch" type="text" placeholder="Search city…" autocomplete="off" spellcheck="false">
     <div class="hw-results" id="hwResults"><div class="hw-result-item hw-result-hint">Type to search…</div></div>`;
  $('hwWeatherChip').appendChild(picker);

  const input = $('hwSearch');
  input.focus();

  input.addEventListener('input', () => {
    clearTimeout(hwSearchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { $('hwResults').innerHTML = '<div class="hw-result-item hw-result-hint">Type to search…</div>'; return; }
    $('hwResults').innerHTML = '<div class="hw-result-item hw-result-hint">Searching…</div>';
    hwSearchTimeout = setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`)
        .then(r => r.json())
        .then(results => {
          if (!results.length) { $('hwResults').innerHTML = '<div class="hw-result-item hw-result-hint">No results</div>'; return; }
          $('hwResults').innerHTML = '';
          results.forEach(r => {
            const a = r.address;
            const city = a.city || a.town || a.village || a.county || a.state || r.display_name.split(',')[0];
            const sub  = [a.state, a.country].filter(Boolean).join(', ');
            const item = document.createElement('div');
            item.className = 'hw-result-item';
            item.innerHTML = `<strong>${city}</strong><span class="hw-result-sub">${sub}</span>`;
            item.addEventListener('click', () => { setLocation(parseFloat(r.lat), parseFloat(r.lon), city); closeLocPicker(); });
            $('hwResults').appendChild(item);
          });
        })
        .catch(() => { $('hwResults').innerHTML = '<div class="hw-result-item hw-result-hint">Search failed</div>'; });
    }, 380);
  });

  input.addEventListener('keydown', e => { if (e.key === 'Escape') closeLocPicker(); });
  setTimeout(() => document.addEventListener('click', hwOutside), 0);
};

$('hwLocBtn').addEventListener('click', e => { e.stopPropagation(); openLocPicker(); });

// ── Init ───────────────────────────────────────────────────────────────────
const initWeather = () => {
  if (hwState.lat !== null) {
    $('hwCity').textContent = hwState.city || '…';
    fetchWeather(hwState.lat, hwState.lon);
    setInterval(() => fetchWeather(hwState.lat, hwState.lon), 10 * 60 * 1000);
    return;
  }
  if (!navigator.geolocation) { $('hwCity').textContent = 'NO GPS'; $('hwIcon').className = 'hw-icon fas fa-location-slash loading'; return; }
  $('hwCity').textContent = 'Detecting…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      reverseGeocode(lat, lon).then(city => setLocation(lat, lon, city));
      setInterval(() => fetchWeather(hwState.lat, hwState.lon), 10 * 60 * 1000);
    },
    () => { $('hwIcon').className = 'hw-icon fas fa-location-slash loading'; $('hwCity').textContent = 'Set loc ✎'; $('hwCond').textContent = '--'; },
    { timeout: 8000 }
  );
};
initWeather();