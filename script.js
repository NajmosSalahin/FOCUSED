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
let taskRunning = false, taskPaused = false, taskStart = null, taskInterval = null, activeEntry = null;
let currentSegStart = null; // start of the current open segment
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
const _syncTermBehind = () => {
  const termEl = $('terminalModal');
  if (!termEl || !termEl.classList.contains('open')) return;
  const anyOpen = document.querySelectorAll('.overlay.open:not(#terminalModal)').length > 0;
  termEl.classList.toggle('behind', anyOpen);
};
const openM = id => {
  $(id).classList.add('open');
  _syncTermBehind();
  requestAnimationFrame(()=>{
    const el=$(id).querySelector('input,select,button:not(.mcls)');
    if(el) el.focus();
  });
};
const closeM = id => {
  $(id).classList.remove('open');
  if (id === 'statsModal') $('openStatsBtn').classList.remove('active');
  _syncTermBehind();
};
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeM(b.dataset.close)));
document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{
  if(e.target===o && !o.hasAttribute('data-no-overlay-close')) { o.classList.remove('open'); _syncTermBehind(); }
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
    if(activeEntry) localStorage.setItem('tt_a',JSON.stringify({
      ...activeEntry,
      startTime: taskStart ? taskStart.toISOString() : null,
      currentSegStart: currentSegStart ? currentSegStart.toISOString() : null,
      taskPaused,
    }));
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
      taskStart = a.startTime ? new Date(a.startTime) : null;
      currentSegStart = a.currentSegStart ? new Date(a.currentSegStart) : null;
      taskPaused = !!a.taskPaused;
      activeEntry={id:a.id,task:a.task,projectId:a.projectId,projectName:a.projectName,segments:a.segments||[],durationMs:a.durationMs||0};
      taskRunning=true;
      taskInput.value=a.task; projSelect.value=a.projectId||'';
      taskInput.readOnly=true; projSelect.disabled=true;
      if(!taskPaused){ startLive(); }
      _setTrackUI(taskPaused ? 'paused' : 'running');
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
// Keyboard shortcuts are registered at the end of the file (expanded set)

// === TASK TRACKER ===
const updateRunningEntry = () => {
  if(!taskRunning||!taskStart||taskPaused) return;
  const segElapsed = currentSegStart ? Date.now() - currentSegStart.getTime() : 0;
  const committed  = activeEntry ? (activeEntry.durationMs||0) : 0;
  const elapsed    = committed + segElapsed;
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

const pauseBtn = $('pauseBtn');

// Set track UI state: 'idle' | 'running' | 'paused'
const _setTrackUI = (state) => {
  if (state === 'idle') {
    trackBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i> START';
    trackBtn.classList.remove('on');
    trackBtn.setAttribute('aria-label','Start task timer');
    pauseBtn.classList.add('hidden');
    pauseBtn.classList.remove('resuming');
  } else if (state === 'running') {
    trackBtn.innerHTML = '<i class="fas fa-stop" aria-hidden="true"></i> STOP';
    trackBtn.classList.add('on');
    trackBtn.setAttribute('aria-label','Stop task timer');
    pauseBtn.innerHTML = '<i class="fas fa-pause" aria-hidden="true"></i> PAUSE';
    pauseBtn.classList.remove('hidden','resuming');
    pauseBtn.setAttribute('aria-label','Pause task timer');
  } else if (state === 'paused') {
    trackBtn.innerHTML = '<i class="fas fa-stop" aria-hidden="true"></i> STOP';
    trackBtn.classList.add('on');
    trackBtn.setAttribute('aria-label','Stop task timer');
    pauseBtn.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i> RESUME';
    pauseBtn.classList.remove('hidden');
    pauseBtn.classList.add('resuming');
    pauseBtn.setAttribute('aria-label','Resume task timer');
  }
};

// Compute total committed ms from closed segments
const _committedMs = (entry) => (entry.segments||[]).reduce((s,seg) => s + (seg.end - seg.start), 0);

// STOP button
trackBtn.addEventListener('click',()=>{
  if(!taskRunning){
    // START
    const desc=taskInput.value.trim();
    if(!desc){ toast('Enter a task description first.','err'); taskInput.focus(); return; }
    const pid=projSelect.value||null, pname=pid?projSelect.options[projSelect.selectedIndex].text:null;
    taskStart = new Date();
    currentSegStart = new Date();
    taskPaused = false;
    activeEntry={id:uid(),task:desc,projectId:pid,projectName:pname,startTime:taskStart.toISOString(),endTime:null,durationMs:0,segments:[]};
    timeEntries.push(activeEntry); taskRunning=true;
    taskInput.readOnly=true; projSelect.disabled=true;
    _setTrackUI('running');
    liveTimer.classList.remove('off'); startLive();
    toast('Timer started!'); save(); rerender();
  } else {
    // STOP — close current segment if not paused
    clearInterval(taskInterval);
    const end = new Date();
    if (!taskPaused && currentSegStart) {
      activeEntry.segments.push({ start: currentSegStart.getTime(), end: end.getTime() });
    }
    const totalMs = _committedMs(activeEntry);
    const idx = timeEntries.findIndex(e=>e.id===activeEntry.id);
    if(idx!==-1){
      timeEntries[idx].endTime = end.toISOString();
      timeEntries[idx].durationMs = totalMs;
      timeEntries[idx].segments = activeEntry.segments;
    }
    updateGoalProgress(activeEntry.projectId, totalMs);
    activeEntry=null; taskStart=null; currentSegStart=null; taskRunning=false; taskPaused=false;
    taskInput.readOnly=false; projSelect.disabled=false;
    taskInput.value=''; projSelect.value='';
    _setTrackUI('idle');
    liveTimer.classList.add('off'); liveTimer.textContent='00:00:00';
    toast('Timer stopped!'); save(); rerender();
  }
});

// PAUSE / RESUME button
pauseBtn.addEventListener('click',()=>{
  if(!taskRunning) return;
  if(!taskPaused){
    // PAUSE — close current segment
    clearInterval(taskInterval);
    const now = new Date();
    if(currentSegStart){
      activeEntry.segments.push({ start: currentSegStart.getTime(), end: now.getTime() });
      activeEntry.durationMs = _committedMs(activeEntry);
      const idx = timeEntries.findIndex(e=>e.id===activeEntry.id);
      if(idx!==-1){ timeEntries[idx].durationMs = activeEntry.durationMs; timeEntries[idx].segments = activeEntry.segments; }
    }
    currentSegStart = null;
    taskPaused = true;
    _setTrackUI('paused');
    // freeze live timer display
    liveTimer.textContent = fmt(activeEntry.durationMs);
    updateTotals(activeEntry.durationMs);
    toast('Timer paused.'); save(); rerender();
  } else {
    // RESUME — open new segment
    currentSegStart = new Date();
    taskPaused = false;
    _setTrackUI('running');
    startLive();
    toast('Timer resumed!'); save(); rerender();
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
    const isRunning = taskRunning && activeEntry && e.id===activeEntry.id;
    const isPaused  = isRunning && taskPaused;
    const color     = e.projectId ? projColor(e.projectId) : '#665c54';

    // Compute elapsed: for running entry use live committed + open segment
    let elapsed;
    if (isRunning && !isPaused && currentSegStart) {
      elapsed = (activeEntry.durationMs||0) + (Date.now() - currentSegStart.getTime());
    } else {
      elapsed = e.durationMs || 0;
    }

    // Build segment time-range string: "09:17 AM → 09:50 AM, 11:50 AM → 12:50 PM"
    const fmtT = d => d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    let rangesHtml = '';
    const segs = e.segments && e.segments.length ? e.segments : [];
    if (segs.length) {
      const parts = segs.map(seg => `${fmtT(new Date(seg.start))} → ${fmtT(new Date(seg.end))}`);
      if (isRunning && !isPaused && currentSegStart) {
        parts.push(`${fmtT(currentSegStart)} → <span style="color:var(--green-b)">now</span>`);
      } else if (isRunning && isPaused && currentSegStart === null && segs.length) {
        // last segment already committed, show paused marker
        parts[parts.length-1] += ` <span style="color:var(--yellow)">[paused]</span>`;
      }
      rangesHtml = parts.join(', ');
    } else {
      // legacy entry with no segments
      const s  = new Date(e.startTime);
      const en = e.endTime ? new Date(e.endTime) : null;
      if (en) {
        rangesHtml = `${fmtT(s)} → ${fmtT(en)}`;
      } else if (isRunning && !isPaused && currentSegStart) {
        rangesHtml = `${fmtT(currentSegStart)} → <span style="color:var(--green-b)">now</span>`;
      } else if (isRunning && isPaused) {
        rangesHtml = `${fmtT(s)} → <span style="color:var(--yellow)">[paused]</span>`;
      } else {
        rangesHtml = fmtT(s);
      }
    }

    const stateClass = isPaused ? ' paused' : isRunning ? ' running' : '';
    const d=document.createElement('div'); d.className=`entry${stateClass}`; d.setAttribute('role','listitem');
    d.innerHTML=`<div class="e-bar" style="background:${color}"></div>
      <div class="e-body">
        <div class="e-task" title="${escHtml(e.task)}">${escHtml(e.task)}</div>
        <div class="e-meta">${e.projectName||'no project'} · ${rangesHtml}</div>
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
const rptFillProjects = () => {
  const sel = $('rProj'); sel.innerHTML = '<option value="">All Projects</option>';
  [...projects].sort((a,b)=>a.name.localeCompare(b.name)).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o);
  });
};
const rptSetRange = (start, end) => {
  const fmt = d => d.toISOString().split('T')[0];
  $('rStart').value = start ? fmt(start) : '';
  $('rEnd').value   = end   ? fmt(end)   : '';
};
$('openReportBtn').addEventListener('click',()=>{
  rptFillProjects();
  $('rStart').value=''; $('rEnd').value='';
  $('rList').innerHTML='<div class="empty">// select a range or preset and generate</div>';
  $('rTotal').style.display='none';
  document.querySelectorAll('.rpt-preset').forEach(b=>b.classList.remove('active'));
  hideErr('rDateErr','rStart'); openM('reportModal');
});

// Quick preset buttons
document.getElementById('rptPresets').addEventListener('click', e => {
  const btn = e.target.closest('.rpt-preset'); if (!btn) return;
  document.querySelectorAll('.rpt-preset').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const today = new Date(); today.setHours(0,0,0,0);
  const r = btn.dataset.range;
  if (r==='today')     { rptSetRange(today, today); }
  else if (r==='yesterday'){ const y=new Date(today); y.setDate(y.getDate()-1); rptSetRange(y,y); }
  else if (r==='week') { const s=new Date(today); s.setDate(s.getDate()-s.getDay()+1); rptSetRange(s,today); }
  else if (r==='month'){ const s=new Date(today.getFullYear(),today.getMonth(),1); rptSetRange(s,today); }
  else if (r==='30')   { const s=new Date(today); s.setDate(s.getDate()-29); rptSetRange(s,today); }
  else if (r==='90')   { const s=new Date(today); s.setDate(s.getDate()-89); rptSetRange(s,today); }
  else if (r==='all')  { rptSetRange(null,null); }
  $('genReportBtn').click();
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
  if(!filtered.length){ rList.innerHTML='<div class="empty">// no entries match this filter</div>'; $('rTotal').style.display='none'; return; }
  let total=0;
  filtered.forEach(x=>{
    const ms = x.endTime ? x.durationMs : (Date.now() - new Date(x.startTime));
    total += ms;
    const st=new Date(x.startTime), en=x.endTime?new Date(x.endTime):null;
    const col = projColor(x.projectId);
    const d=document.createElement('div'); d.className='rentry';
    d.innerHTML=`<div class="rentry-h">
      <span class="rentry-dot" style="background:${col}"></span>
      <span class="rentry-task">${escHtml(x.task||'Untitled')}</span>
      <span class="rentry-dur" style="color:var(--aqua-b)">${fmt(ms)}</span>
    </div>
    <div class="rentry-m">${x.projectName||'<span style="color:var(--bg3)">no project</span>'} · ${st.toLocaleDateString()} ${st.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${en?' → '+en.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'<span class="rentry-running"> ● running</span>'}</div>`;
    rList.appendChild(d);
  });
  $('rTotalVal').textContent=fmt(total);
  $('rTotalCount').textContent=`${filtered.length} entr${filtered.length===1?'y':'ies'} · `;
  $('rTotal').style.display='flex';
});

// === EXPORT/IMPORT ===
$('openExportBtn').addEventListener('click',()=>{
  // Populate export summary
  const hab = JSON.parse(localStorage.getItem('tt_hab')||'[]');
  const ph  = JSON.parse(localStorage.getItem('tt_ph')||'{}');
  const total = timeEntries.reduce((s,e)=>s+(e.durationMs||0),0);
  const hrs = (total/3600000).toFixed(1);
  $('exportSummary').innerHTML = `
    <div class="export-row"><span class="export-lbl">Time entries</span><span class="export-val">${timeEntries.length}</span></div>
    <div class="export-row"><span class="export-lbl">Total tracked</span><span class="export-val">${hrs}h</span></div>
    <div class="export-row"><span class="export-lbl">Projects</span><span class="export-val">${projects.length}</span></div>
    <div class="export-row"><span class="export-lbl">Goals</span><span class="export-val">${goals.length}</span></div>
    <div class="export-row"><span class="export-lbl">Habits</span><span class="export-val">${hab.filter(h=>!h.archived).length} active</span></div>
    <div class="export-row"><span class="export-lbl">Pomodoro sessions</span><span class="export-val">${Object.values(ph).reduce((s,v)=>s+v,0)}</span></div>`;
  openM('exportModal');
});
$('confirmExportBtn').addEventListener('click',()=>{
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    projects, goals, timeEntries,
    habits: JSON.parse(localStorage.getItem('tt_hab') || '[]'),
    habitCompletions: JSON.parse(localStorage.getItem('tt_hc') || '{}'),
    pomoHistory: JSON.parse(localStorage.getItem('tt_ph') || '{}'),
  };
  const b=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download=`focugruv_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  closeM('exportModal'); toast('✓ Full backup exported!');
});

// ─── PDF SUMMARY ─────────────────────────────────────────────
document.addEventListener('click', e => {
  if (e.target.closest('#openPdfSummaryBtn') || e.target.closest('#statsPdfBtn')) generatePDFSummary();
});

function generatePDFSummary() {
  toast('Building PDF summary…');

  // ── Data prep ─────────────────────────────────────────────
  const now     = new Date();
  const msToHrs = ms => ms / 3600000;
  const msFmt   = ms => { if (!ms) return '0m'; const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000); return h>0?`${h}h ${m}m`:`${m}m`; };
  const pct     = (a,b) => b > 0 ? Math.round(a/b*100) : 0;
  const sumArr  = arr => arr.reduce((s,v)=>s+v,0);
  const meanArr = arr => arr.length ? sumArr(arr)/arr.length : 0;
  const medArr  = arr => { if(!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b),m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const stdArr  = arr => { if(arr.length<2) return 0; const mn=meanArr(arr); return Math.sqrt(arr.reduce((s,v)=>s+(v-mn)**2,0)/(arr.length-1)); };
  const slopeOf = ys => { const n=ys.length; if(n<2) return 0; const xs=ys.map((_,i)=>i),mx=meanArr(xs),my=meanArr(ys),num=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0),den=xs.reduce((s,x)=>s+(x-mx)**2,0); return den?num/den:0; };

  const DAYS = 30;
  const dayData = [];
  for (let i = DAYS-1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    const key = d.toISOString().slice(0,10);
    const ms  = timeEntries.filter(e=>e.startTime&&new Date(e.startTime).toISOString().slice(0,10)===key).reduce((s,e)=>s+(e.durationMs||0),0);
    dayData.push({ date:d, key, ms, hrs:msToHrs(ms), label:i===0?'Today':d.getDate()===1?d.toLocaleString('en',{month:'short'}):String(d.getDate()) });
  }

  const totalMs  = sumArr(timeEntries.map(e=>e.durationMs||0));
  const trackedD = new Set(timeEntries.map(e=>e.startTime&&new Date(e.startTime).toISOString().slice(0,10)).filter(Boolean)).size;
  const avgDayMs = trackedD > 0 ? totalMs/trackedD : 0;

  const dowMs = Array(7).fill(0);
  timeEntries.forEach(e=>{ let d=new Date(e.startTime).getDay(); d=d===0?6:d-1; dowMs[d]+=(e.durationMs||0); });
  const DOW_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const hourMs = Array(24).fill(0);
  timeEntries.forEach(e=>{ hourMs[new Date(e.startTime).getHours()]+=(e.durationMs||0); });

  const projData = projects.map((p,i)=>({
    name:p.name, ms:timeEntries.filter(e=>e.projectId===p.id).reduce((s,e)=>s+(e.durationMs||0),0),
    color:PROJ_COLORS[i%PROJ_COLORS.length]
  })).filter(p=>p.ms>0).sort((a,b)=>b.ms-a.ms);

  const taskMap = {};
  timeEntries.forEach(e=>{ if(!e.task) return; taskMap[e.task]=(taskMap[e.task]||0)+(e.durationMs||0); });
  const topTasks = Object.entries(taskMap).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const activeHabs = habits.filter(h=>!h.archived);
  const c          = habComp();
  const habStats   = activeHabs.map(h=>({ h, streak:habStreak(h.id), rate28:habRate(h.id,28), color:h.color||'#b8bb26' })).sort((a,b)=>b.rate28-a.rate28);

  const durSecs = timeEntries.map(e=>(e.durationMs||0)/1000).filter(v=>v>0);
  const slope   = slopeOf(dayData.map(d=>d.hrs));

  const daySet = new Set(timeEntries.map(e=>e.startTime&&new Date(e.startTime).toISOString().slice(0,10)).filter(Boolean));
  let curS=0; { let d=new Date(now); while(daySet.has(d.toISOString().slice(0,10))){curS++;d.setDate(d.getDate()-1);} }
  let maxS=0,runS=0; { let d=new Date(now); for(let i=0;i<365;i++){if(daySet.has(d.toISOString().slice(0,10)))runS++;else runS=0;maxS=Math.max(maxS,runS);d.setDate(d.getDate()-1);} }
  const pomosToday = pomoLog.filter(s=>s.mode==='work').length;

  // ── SVG helpers ───────────────────────────────────────────
  const W = 640, PAD = 36;
  const svgWrap = (content,h,vbW) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW||W} ${h}" width="100%" style="display:block">${content}</svg>`;
  const svgT = (x,y,txt,o={}) => `<text x="${x}" y="${y}" font-family="Courier New,monospace" font-size="${o.sz||10}" fill="${o.fill||'#a89984'}" font-weight="${o.b?700:400}" text-anchor="${o.anc||'start'}" dominant-baseline="${o.base||'auto'}">${String(txt).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`;
  const svgR = (x,y,w,h,col,rx=2) => w>0&&h>0?`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(w,0.5).toFixed(1)}" height="${Math.max(h,0.5).toFixed(1)}" fill="${col}" rx="${rx}"/>`:'';

  // Daily bar chart
  const buildDaily = () => {
    const cH=100,cW=W-PAD*2,top=12,bot=20,maxHrs=Math.max(...dayData.map(d=>d.hrs),0.1);
    const bW=Math.max(2,cW/DAYS-2),gap=cW/DAYS,mn=meanArr(dayData.map(d=>d.hrs));
    let els='';
    for(let i=1;i<=4;i++){const y=top+cH*(1-i/4);els+=`<line x1="${PAD}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#ddd" stroke-width="0.5"/>`;els+=svgT(PAD-4,y+3,msFmt(maxHrs*i/4*3600000),{sz:8,anc:'end'});}
    dayData.forEach((d,i)=>{const x=PAD+gap*i+(gap-bW)/2,bH=Math.max(d.hrs>0?2:0,(d.hrs/maxHrs)*cH),isToday=i===DAYS-1,above=d.hrs>mn;els+=svgR(x,top+cH-bH,bW,bH,isToday?'#689d6a':above?'#8ec07c88':'#b8d8b888',2);if(i%5===0||i===DAYS-1)els+=svgT(x+bW/2,top+cH+14,d.label,{sz:8,anc:'middle',fill:'#888'});});
    const avgY=top+cH-(mn/maxHrs)*cH;
    els+=`<line x1="${PAD}" y1="${avgY}" x2="${W-PAD}" y2="${avgY}" stroke="#83a598" stroke-width="1" stroke-dasharray="3 3"/>`;
    els+=svgT(W-PAD+3,avgY+3,'avg',{sz:8,fill:'#83a598'});
    // Trend line
    const sl=slopeOf(dayData.map(d=>d.hrs));
    if(Math.abs(sl)>0.001){const pts=dayData.map((d,i)=>{const yv=mn+sl*(i-(DAYS-1)/2),x=PAD+gap*i+gap/2,y=top+cH-Math.min(Math.max(yv/maxHrs,0),1)*cH;return `${x.toFixed(1)},${y.toFixed(1)}`;});els+=`<polyline points="${pts.join(' ')}" fill="none" stroke="#d79921" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>`;}
    return svgWrap(els,top+cH+bot);
  };

  // Project donut
  const buildDonut = () => {
    if(!projData.length) return '<p style="color:#aaa;font-size:10px">No project data</p>';
    const cx=90,cy=80,r=60,inner=36,total=sumArr(projData.map(p=>p.ms));
    let angle=-Math.PI/2,els='';
    projData.slice(0,8).forEach(p=>{const sw=(p.ms/total)*2*Math.PI,x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(angle+sw),y2=cy+r*Math.sin(angle+sw),lg=sw>Math.PI?1:0;els+=`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${lg},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${p.color}" opacity="0.82"/>`;angle+=sw;});
    els+=`<circle cx="${cx}" cy="${cy}" r="${inner}" fill="#fff"/>`;
    els+=svgT(cx,cy-5,msFmt(total),{sz:10,anc:'middle',fill:'#282828',b:true,base:'middle'});
    els+=svgT(cx,cy+7,'total',{sz:8,anc:'middle',fill:'#aaa',base:'middle'});
    projData.slice(0,8).forEach((p,i)=>{const lx=168,ly=8+i*20;els+=svgR(lx,ly+2,9,9,p.color,2);const nm=p.name.length>18?p.name.slice(0,17)+'…':p.name;els+=svgT(lx+13,ly+10,nm,{sz:8,fill:'#666'});els+=svgT(lx+160,ly+10,msFmt(p.ms),{sz:8,fill:'#282828',anc:'end',b:true});els+=svgT(lx+167,ly+10,`${pct(p.ms,total)}%`,{sz:7,fill:'#aaa'});});
    return svgWrap(els,170,W);
  };

  // DoW bars
  const buildDow = () => {
    const maxMs=Math.max(...dowMs,1),bMaxW=200,labW=32;
    let els='',H=DOW_NAMES.length*24+8;
    DOW_NAMES.forEach((nm,i)=>{const y=4+i*24,bW=(dowMs[i]/maxMs)*bMaxW,isMax=dowMs[i]===Math.max(...dowMs);els+=svgT(labW-4,y+13,nm,{sz:9,anc:'end',fill:'#888'});if(bW>0)els+=svgR(labW,y+2,bW,14,isMax?'#d7992188':'#4585884d',2);els+=svgT(labW+bW+5,y+13,dowMs[i]?msFmt(dowMs[i]):'—',{sz:9,fill:isMax?'#d79921':'#aaa'});});
    return svgWrap(els,H,labW+bMaxW+80);
  };

  // Hour heatmap
  const buildHeatmap = () => {
    const cW=W-PAD*2,cSize=Math.floor(cW/24)-2,maxH=Math.max(...hourMs,1);
    let els='';
    hourMs.forEach((ms,h)=>{const x=PAD+h*(cSize+2),intens=ms/maxH,fill=ms>0?`rgba(104,157,106,${(0.15+intens*0.85).toFixed(2)})`:'#f0ede8';els+=svgR(x,4,cSize,20,fill,3);if(h%4===0)els+=svgT(x+cSize/2,34,`${String(h).padStart(2,'0')}`,{sz:8,anc:'middle',fill:'#aaa'});});
    return svgWrap(els,42);
  };

  // Duration histogram
  const buildHist = () => {
    const bkts=[0,5,10,15,20,30,45,60,90,120,180],lbls=bkts.slice(0,-1).map((b,i)=>`${b}-${bkts[i+1]}`);
    const cnts=new Array(bkts.length-1).fill(0);
    timeEntries.forEach(e=>{const m=(e.durationMs||0)/60000;for(let i=0;i<bkts.length-1;i++){if(m>=bkts[i]&&m<bkts[i+1]){cnts[i]++;break;}}});
    const maxC=Math.max(...cnts,1),cH=80,cW=W-PAD*2,top=8,bot=20,bW=Math.max(3,cW/cnts.length-3),gap=cW/cnts.length;
    let els='';
    for(let i=1;i<=4;i++){const y=top+cH*(1-i/4);els+=`<line x1="${PAD}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#ddd" stroke-width="0.5"/>`;els+=svgT(PAD-4,y+3,Math.round(maxC*i/4),{sz:8,anc:'end'});}
    cnts.forEach((c,i)=>{const x=PAD+gap*i+(gap-bW)/2,bH=Math.max(c>0?2:0,(c/maxC)*cH);els+=svgR(x,top+cH-bH,bW,bH,'#d3869b88',2);els+=svgT(x+bW/2,top+cH+14,lbls[i],{sz:7,anc:'middle',fill:'#aaa'});if(c>0)els+=svgT(x+bW/2,top+cH-bH-2,c,{sz:7,anc:'middle',fill:'#888'});});
    return svgWrap(els,top+cH+bot);
  };

  // Goals bars
  const buildGoals = () => {
    if(!goals.length) return '<p style="color:#aaa;font-size:10px">No goals set</p>';
    const bMaxW=260,labW=130,rowH=24;
    let els='',H=goals.length*rowH+8;
    goals.forEach((g,i)=>{const y=4+i*rowH,p2=Math.min(100,pct(g.currentMs||0,g.targetMs||1)),bW=p2/100*bMaxW,col=p2>=100?'#b8bb2666':p2>=70?'#d7992166':'#45858866',nm=g.name.length>17?g.name.slice(0,16)+'…':g.name;els+=svgT(labW-4,y+14,nm,{sz:9,anc:'end',fill:'#666'});els+=svgR(labW,y+3,bMaxW,14,'#eee',2);if(bW>0)els+=svgR(labW,y+3,bW,14,col,2);els+=svgT(labW+bMaxW+6,y+14,`${p2}%  ${msFmt(g.currentMs)}/${msFmt(g.targetMs)}`,{sz:8,fill:p2>=100?'#689d6a':'#aaa'});});
    return svgWrap(els,H,labW+bMaxW+200);
  };

  // Habit bars
  const buildHabs = () => {
    if(!habStats.length) return '<p style="color:#aaa;font-size:10px">No habits tracked</p>';
    const bMaxW=180,labW=130,rowH=22;
    let els='',H=habStats.length*rowH+8;
    habStats.forEach(({h,rate28,streak,color},i)=>{const y=4+i*rowH,bW=rate28/100*bMaxW,nm=(h.icon||'')+' '+(h.name.length>15?h.name.slice(0,14)+'…':h.name);els+=svgT(labW-4,y+13,nm.trim(),{sz:9,anc:'end',fill:'#666'});if(bW>0)els+=svgR(labW,y+3,bW,14,color+'88',2);els+=svgT(labW+bW+5,y+13,`${rate28}%`,{sz:9,fill:rate28>=70?color:'#aaa'});els+=svgT(labW+bMaxW+10,y+13,`${streak}d`,{sz:8,fill:'#d79921'});});
    return svgWrap(els,H,labW+bMaxW+70);
  };

  // ── Helpers ───────────────────────────────────────────────
  const kpi = (val,lbl,col) => `<div class="kc"><div class="kv" style="color:${col}">${val}</div><div class="kl">${lbl}</div></div>`;
  const sec = (t,col='#458588') => `<div class="sec" style="border-left-color:${col};color:${col}">${t}</div>`;
  const card = (label,content) => `<div class="card"><div class="card-lbl">${label}</div>${content}</div>`;
  const mrow = (k,v) => `<div class="mr"><span class="mk">${k}</span><span class="mv">${v}</span></div>`;

  // ── Weather data for PDF ──────────────────────────────────
  const wxHist   = window.wxLoad ? window.wxLoad() : [];
  const wxLatest = wxHist[wxHist.length - 1] || null;
  const wxDayMap = {};
  wxHist.forEach(s => {
    if (!wxDayMap[s.date]) wxDayMap[s.date] = { temps:[], humids:[], precips:[], winds:[], codes:[] };
    wxDayMap[s.date].temps.push(s.temp);
    wxDayMap[s.date].humids.push(s.humid);
    wxDayMap[s.date].precips.push(s.precip);
    wxDayMap[s.date].winds.push(s.wind);
    wxDayMap[s.date].codes.push(s.code);
  });
  const wxDays = Object.entries(wxDayMap).map(([date, d]) => ({
    date,
    hrs: timeEntries.filter(e=>e.startTime&&new Date(e.startTime).toISOString().slice(0,10)===date).reduce((s,e)=>s+(e.durationMs||0)/3600000,0),
    temp:   d.temps.reduce((s,v)=>s+v,0)/d.temps.length,
    humid:  d.humids.reduce((s,v)=>s+v,0)/d.humids.length,
    precip: d.precips.reduce((s,v)=>s+v,0),
    wind:   d.winds.reduce((s,v)=>s+v,0)/d.winds.length,
    cat:    window.wxInfo ? window.wxInfo(Math.round(d.codes.reduce((s,v)=>s+v,0)/d.codes.length)).cat : 'unknown',
  })).sort((a,b)=>a.date.localeCompare(b.date));
  const wxPaired = wxDays.filter(d=>d.hrs>0);
  const wxRr = (xs,ys) => { const n=xs.length; if(n<3) return null; const mx=xs.reduce((s,v)=>s+v,0)/n,my=ys.reduce((s,v)=>s+v,0)/n,num=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0),den=Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));return den?+(num/den).toFixed(3):null; };
  const wxRT=wxRr(wxPaired.map(d=>d.temp),wxPaired.map(d=>d.hrs)),wxRH=wxRr(wxPaired.map(d=>d.humid),wxPaired.map(d=>d.hrs)),wxRP=wxRr(wxPaired.map(d=>d.precip),wxPaired.map(d=>d.hrs)),wxRW=wxRr(wxPaired.map(d=>d.wind),wxPaired.map(d=>d.hrs));

  const buildWxDual = () => {
    if (!wxHist.length) return '<p style="color:#aaa;font-size:10px">Enable location access in Statistics to collect weather data.</p>';
    const last14=[];
    for(let i=13;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);d.setHours(0,0,0,0);const k=d.toISOString().slice(0,10);last14.push({label:i===0?'Today':String(d.getDate()),wxd:wxDayMap[k]||null,hrs:timeEntries.filter(e=>e.startTime&&new Date(e.startTime).toISOString().slice(0,10)===k).reduce((s,e)=>s+(e.durationMs||0)/3600000,0)});}
    const maxH=Math.max(...last14.map(d=>d.hrs),0.1);
    const vt=last14.filter(d=>d.wxd?.temps?.length).map(d=>d.wxd.temps.reduce((s,v)=>s+v,0)/d.wxd.temps.length);
    const minT=vt.length?Math.min(...vt)-2:0,maxT=vt.length?Math.max(...vt)+2:30;
    const cH=80,cW=W-PAD*2,top=10,bot=16,gap=cW/14,bW=Math.max(2,gap-2);
    let els='';
    for(let i=1;i<=3;i++){const y=top+cH*(1-i/3);els+=`<line x1="${PAD}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;els+=svgT(PAD-3,y+3,(maxH*i/3).toFixed(1)+'h',{sz:7,anc:'end'});}
    last14.forEach((d,i)=>{const x=PAD+gap*i+(gap-bW)/2,bH=Math.max(d.hrs>0?2:0,(d.hrs/maxH)*cH);if(d.hrs>0)els+=svgR(x,top+cH-bH,bW,bH,i===13?'#8ec07c88':'#45858855',2);if(i%3===0||i===13)els+=svgT(x+bW/2,top+cH+11,d.label,{sz:7,anc:'middle',fill:'#aaa'});});
    const pts=last14.map((d,i)=>{if(!d.wxd?.temps?.length)return null;const t=d.wxd.temps.reduce((s,v)=>s+v,0)/d.wxd.temps.length,x=PAD+gap*i+gap/2,y=top+cH-cH*(t-minT)/(maxT-minT);return `${x.toFixed(1)},${y.toFixed(1)}`;}).filter(Boolean);
    if(pts.length>1){els+=`<polyline points="${pts.join(' ')}" fill="none" stroke="#fe8019" stroke-width="1.5"/>`;pts.forEach(pt=>{const[x,y]=pt.split(',');els+=`<circle cx="${x}" cy="${y}" r="2" fill="#fe8019"/>`;});}
    for(let i=0;i<=3;i++){const t=minT+(maxT-minT)*i/3,y=top+cH-cH*i/3;els+=svgT(W-PAD+2,y+3,t.toFixed(0)+'°',{sz:7,fill:'#fe8019aa'});}
    return svgWrap(els,top+cH+bot);
  };

  const buildWxCat = () => {
    if(!wxPaired.length) return '<p style="color:#aaa;font-size:10px">No matched data yet</p>';
    const cats=['clear','cloudy','rain','snow','storm'],labels=['☀ Clear','⛅ Cloudy','🌧 Rain','❄ Snow','⛈ Storm'],cols=['#d79921','#458588','#1d6b8b','#d3869b','#cc241d'];
    const avgs=cats.map(cat=>{const m=wxPaired.filter(d=>d.cat===cat);return m.length?m.reduce((s,d)=>s+d.hrs,0)/m.length:0;});
    const maxA=Math.max(...avgs,0.1),labW=70,bMaxW=180;
    let els='',H=cats.length*24+8;
    cats.forEach((c,i)=>{const y=4+i*24,bW=(avgs[i]/maxA)*bMaxW,cnt=wxPaired.filter(d=>d.cat===c).length;els+=svgT(labW-4,y+13,labels[i],{sz:9,anc:'end',fill:'#666'});if(bW>0)els+=svgR(labW,y+3,bW,13,cols[i]+'88',2);els+=svgT(labW+bW+5,y+13,avgs[i]>0?`${avgs[i].toFixed(1)}h · ${cnt}d`:'—',{sz:8,fill:avgs[i]>0?'#282828':'#aaa'});});
    return svgWrap(els,H,labW+bMaxW+100);
  };

  const buildWxScatter = () => {
    if(wxPaired.length<3) return `<p style="color:#aaa;font-size:10px">Need ${3-wxPaired.length} more matched days</p>`;
    const xs=wxPaired.map(d=>d.temp),ys=wxPaired.map(d=>d.hrs),minX=Math.min(...xs)-2,maxX=Math.max(...xs)+2,maxY=Math.max(...ys,0.1);
    const catC={clear:'#d79921',cloudy:'#458588',rain:'#1d6b8b',snow:'#d3869b',storm:'#cc241d',unknown:'#aaa'};
    const cH=90,cW=W-PAD*2,top=8,bot=18;
    let els='';
    for(let i=0;i<=3;i++){const y=top+cH*(1-i/3);els+=`<line x1="${PAD}" y1="${y}" x2="${W-PAD}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;els+=svgT(PAD-3,y+3,(maxY*i/3).toFixed(1)+'h',{sz:7,anc:'end'});}
    for(let i=0;i<=4;i++){const x=PAD+cW*i/4;els+=svgT(x,top+cH+12,(minX+(maxX-minX)*i/4).toFixed(0)+'°',{sz:7,anc:'middle',fill:'#aaa'});}
    const n=xs.length,mx=xs.reduce((s,v)=>s+v,0)/n,my=ys.reduce((s,v)=>s+v,0)/n,sl=(xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0))/(xs.reduce((s,x)=>s+(x-mx)**2,0)||1),ic=my-sl*mx;
    els+=`<line x1="${PAD}" y1="${(top+cH-cH*Math.max(0,sl*minX+ic)/maxY).toFixed(1)}" x2="${(W-PAD).toFixed(1)}" y2="${(top+cH-cH*Math.max(0,sl*maxX+ic)/maxY).toFixed(1)}" stroke="#d79921" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`;
    wxPaired.forEach(d=>{const x=PAD+cW*(d.temp-minX)/(maxX-minX),y=top+cH-cH*(d.hrs/maxY);els+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${catC[d.cat]||'#aaa'}88" stroke="${catC[d.cat]||'#aaa'}" stroke-width="0.5"/>`;});
    if(wxRT!==null)els+=svgT(W-PAD,top+8,`r = ${wxRT}`,{sz:8,anc:'end',fill:'#888'});
    return svgWrap(els,top+cH+bot);
  };

  const wxCorrRow = (icon,name,r) => {
    const a=r!==null?Math.abs(r):0,col=r===null?'#aaa':a>0.7?(r>0?'#689d6a':'#cc241d'):a>0.4?(r>0?'#d79921':'#fe8019'):a>0.2?'#458588':'#aaa';
    const lbl=r===null?'no data':a>0.7?(r>0?'Strong ↑':'Strong ↓'):a>0.4?(r>0?'Moderate ↑':'Moderate ↓'):a>0.2?(r>0?'Weak ↑':'Weak ↓'):'Negligible';
    return `<tr><td>${icon}</td><td style="font-size:10px">${name}</td><td style="font-weight:700;color:${col};text-align:right">${r!==null?r:'—'}</td><td style="color:${col};font-size:9px;text-align:center">${lbl}</td><td><div style="height:8px;width:${(a*80).toFixed(0)}px;background:${col}55;border-radius:2px;min-width:4px"></div></td></tr>`;
  };

  const peakH  = hourMs.indexOf(Math.max(...hourMs));
  const bestDow= dowMs.indexOf(Math.max(...dowMs));
  const insights = [];
  if(slope>0.01)  insights.push(`<b>📈 Upward trend</b> — daily time is growing by ~${msFmt(slope*3600000)}/day.`);
  else if(slope<-0.01) insights.push(`<b>📉 Downward trend</b> — daily time shrinking. Consider a focus reset.`);
  if(curS>=7)    insights.push(`<b>🔥 ${curS}-day streak</b> — excellent consistency, keep it up!`);
  if(curS===0)   insights.push(`<b>⚡ No current streak</b> — log at least one session today to restart.`);
  insights.push(`<b>🕐 Peak hour ${String(peakH).padStart(2,'0')}:00</b> — your brain is sharpest then. Protect it.`);
  insights.push(`<b>📅 ${DOW_NAMES[bestDow]} is your best day</b> (${msFmt(dowMs[bestDow])} avg).`);
  if(habStats.length) insights.push(`<b>✅ Top habit: ${habStats[0].h.icon||''}${habStats[0].h.name}</b> — ${habStats[0].rate28}% completion rate.`);
  const cv = (stdArr(dayData.map(d=>d.hrs))/(meanArr(dayData.map(d=>d.hrs))||1)*100).toFixed(0);
  insights.push(`<b>📊 Consistency (CV): ${cv}%</b> — ${Number(cv)<30?'very stable':'high variance in daily time'}.`);

  // ── Full HTML document ─────────────────────────────────────
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>FOCUSED Report — ${now.toLocaleDateString()}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',Courier,monospace;font-size:11px;color:#282828;background:#fff;line-height:1.5}
.print-bar{text-align:center;padding:14px;background:#f5f0eb;border-bottom:1px solid #ddd}
.print-btn{font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:1px;background:#282828;color:#f5f0eb;border:none;padding:8px 22px;border-radius:3px;cursor:pointer;margin-right:8px}
.print-btn:hover{background:#3c3836}
.page{width:740px;margin:0 auto;padding:32px 44px 44px}
/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #282828;padding-bottom:14px;margin-bottom:20px}
.logo{font-size:24px;font-weight:900;letter-spacing:2px;color:#282828}.logo span{color:#689d6a}
.meta{font-size:9px;color:#888;text-align:right;line-height:1.8}
/* KPI */
.kpi-row{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-bottom:20px}
.kc{background:#f9f7f4;border:1px solid #e8e2db;border-radius:4px;padding:8px 10px;text-align:center}
.kv{font-size:18px;font-weight:900;line-height:1.1;margin-bottom:2px}
.kl{font-size:8px;color:#999;letter-spacing:.5px;text-transform:uppercase}
/* Section */
.sec{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:16px 0 8px;padding-left:7px;border-left:3px solid #458588}
/* Cards */
.card{background:#f9f7f4;border:1px solid #e8e2db;border-radius:4px;padding:12px;margin-bottom:10px}
.card-lbl{font-size:9px;font-weight:700;color:#999;letter-spacing:.7px;margin-bottom:8px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}
/* Math grid */
.math-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e8e2db;border:1px solid #e8e2db;border-radius:4px;overflow:hidden;margin-bottom:10px}
.mr{display:contents}
.mk{background:#f9f7f4;font-size:9px;color:#999;padding:5px 7px;border:none}
.mv{background:#fff;font-size:10px;font-weight:700;color:#282828;padding:5px 7px;border:none}
/* Tasks */
.tbl{width:100%;border-collapse:collapse;font-size:10px}
.tbl th{background:#f0ebe4;color:#999;font-size:8px;letter-spacing:.5px;padding:5px 8px;text-align:left;border-bottom:1px solid #e8e2db}
.tbl td{padding:5px 8px;border-bottom:1px solid #f5f0eb;color:#282828}
.tbl td.r{text-align:right;color:#689d6a;font-weight:700}
.tbl tr:nth-child(even) td{background:#faf8f5}
/* Insights */
.insights{background:#f9f7f4;border:1px solid #e8e2db;border-radius:4px;padding:12px}
.ins{font-size:10px;color:#504945;padding:4px 0;border-bottom:1px solid #f0ebe4;line-height:1.6}
.ins:last-child{border-bottom:none}
.ins b{color:#282828}
/* Footer */
.ftr{margin-top:28px;padding-top:10px;border-top:1px solid #e8e2db;font-size:8px;color:#aaa;display:flex;justify-content:space-between}
@media print{
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .print-bar{display:none}
  .page{padding:0}
  @page{margin:12mm 14mm;size:A4}
  .kc{background:#f9f7f4!important}
  .card{background:#f9f7f4!important}
  .math-grid{background:#e8e2db!important}
  .mk{background:#f9f7f4!important}
}
</style></head><body>

<div class="print-bar">
  <button class="print-btn" onclick="window.print()">⬇ SAVE AS PDF</button>
  <span style="font-size:10px;color:#888">Use "Save as PDF" in your browser's print dialog</span>
</div>

<div class="page">
  <div class="hdr">
    <div><div class="logo">FOCUS<span>GRUV</span></div><div style="font-size:9px;color:#aaa;margin-top:2px">Productivity Summary Report</div></div>
    <div class="meta">Generated: ${now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}<br>All-time data · ${timeEntries.length} sessions · ${trackedD} tracked days</div>
  </div>

  <div class="kpi-row">
    ${kpi(msFmt(totalMs),'Total Tracked','#689d6a')}
    ${kpi(msFmt(avgDayMs),'Daily Avg','#458588')}
    ${kpi(timeEntries.length,'Sessions','#d79921')}
    ${kpi(curS+'d','Streak','#cc241d')}
    ${kpi(maxS+'d','Best Streak','#b16286')}
    ${kpi(activeHabs.length,'Active Habits','#689d6a')}
  </div>

  ${sec('DAILY TRACKED TIME — LAST 30 DAYS','#458588')}
  ${card('HOURS PER DAY · green dashes = avg · yellow dashes = trend',buildDaily())}

  ${sec('PROJECT BREAKDOWN  &  DAY-OF-WEEK PATTERN','#d79921')}
  <div class="two-col">
    ${card('PROJECT SPLIT (ALL TIME)',buildDonut())}
    ${card('HOURS BY DAY OF WEEK',buildDow())}
  </div>

  ${sec('HOUR-OF-DAY ACTIVITY HEATMAP','#689d6a')}
  ${card('INTENSITY BY HOUR (00–23) — darker green = more tracked time',buildHeatmap())}

  ${sec('SESSION DURATION DISTRIBUTION','#b16286')}
  ${card('SESSIONS COUNT BY DURATION BUCKET (MINUTES)',buildHist())}

  ${sec('GOALS PROGRESS','#98971a')}
  ${card('CURRENT PROGRESS TOWARD EACH GOAL',buildGoals())}

  ${sec('HABITS — 28-DAY COMPLETION RATE','#98971a')}
  ${card('COMPLETION % OVER LAST 28 DAYS · streak in days (right)',buildHabs())}

  ${sec('TOP 10 TASKS BY TIME','#cc241d')}
  <div class="card" style="padding:0;overflow:hidden">
    <table class="tbl"><thead><tr><th>#</th><th>TASK</th><th>TIME</th><th>% OF TOTAL</th></tr></thead>
    <tbody>${topTasks.map(([task,ms],i)=>`<tr><td style="color:#aaa">${i+1}</td><td>${(task.length>55?task.slice(0,54)+'…':task)}</td><td class="r">${msFmt(ms)}</td><td class="r">${pct(ms,totalMs)}%</td></tr>`).join('')}</tbody></table>
  </div>

  ${sec('STATISTICAL SUMMARY','#458588')}
  <div class="math-grid">
    ${mrow('Mean session',    msFmt(meanArr(durSecs)*1000))}
    ${mrow('Median session',  msFmt(medArr(durSecs)*1000))}
    ${mrow('Std deviation',   msFmt(stdArr(durSecs)*1000))}
    ${mrow('Longest session', msFmt(Math.max(...durSecs,0)*1000))}
    ${mrow('Shortest session',msFmt((Math.min(...durSecs.filter(v=>v>0))||0)*1000))}
    ${mrow('Total sessions',  timeEntries.length)}
    ${mrow('Tracked days',    trackedD)}
    ${mrow('Current streak',  curS+' days')}
    ${mrow('Best streak',     maxS+' days')}
    ${mrow('Peak hour',       String(peakH).padStart(2,'0')+':00')}
    ${mrow('Best weekday',    DOW_NAMES[bestDow])}
    ${mrow('Daily trend',     (slope>=0?'+':'')+msFmt(Math.abs(slope)*3600000)+'/day')}
    ${mrow('Consistency CV',  cv+'%')}
    ${mrow('Total projects',  projects.length)}
    ${mrow('Active habits',   activeHabs.length)}
    ${mrow('Pomodoros today', pomosToday)}
  </div>

  ${sec('AUTO-GENERATED INSIGHTS','#d65d0e')}
  <div class="insights">${insights.map(t=>`<div class="ins">${t}</div>`).join('')}</div>

  ${wxHist.length ? `
  ${sec('WEATHER × PRODUCTIVITY','#458588')}
  ${wxLatest ? `<div class="card" style="display:flex;gap:16px;flex-wrap:wrap">
    ${window.wxInfo ? `<div style="font-size:24px">${window.wxInfo(wxLatest.code).e}</div>` : ''}
    <div><div style="font-size:14px;font-weight:700;color:#282828">${wxLatest.temp}°C &nbsp;<span style="font-size:10px;color:#888">feels ${wxLatest.feels}°C</span></div>
    <div style="font-size:9px;color:#888">${window.wxInfo ? window.wxInfo(wxLatest.code).l : ''} &nbsp;·&nbsp; 💧${wxLatest.humid}% &nbsp;·&nbsp; 💨${wxLatest.wind}km/h &nbsp;·&nbsp; 🌧${wxLatest.precip}mm</div>
    <div style="font-size:8px;color:#aaa;margin-top:2px">Updated ${new Date(wxLatest.ts).toLocaleString()} &nbsp;·&nbsp; ${wxHist.length} snapshots collected</div></div>
  </div>` : ''}

  <div class="two-col">
    ${card('DAILY HOURS + TEMPERATURE OVERLAY (14 DAYS)', buildWxDual())}
    ${card('AVG PRODUCTIVITY BY WEATHER CATEGORY', buildWxCat())}
  </div>
  ${card('TEMPERATURE vs HOURS SCATTER PLOT', buildWxScatter())}

  ${sec('WEATHER CORRELATION MATRIX','#458588')}
  <div class="card" style="padding:0;overflow:hidden">
    <table class="tbl">
      <thead><tr><th></th><th>WEATHER FACTOR</th><th style="text-align:right">r</th><th style="text-align:center">STRENGTH</th><th>BAR</th></tr></thead>
      <tbody>
        ${wxCorrRow('🌡️','Temperature (°C)', wxRT)}
        ${wxCorrRow('💧','Humidity (%)', wxRH)}
        ${wxCorrRow('🌧️','Precipitation (mm)', wxRP)}
        ${wxCorrRow('💨','Wind speed (km/h)', wxRW)}
      </tbody>
    </table>
  </div>
  <div class="card" style="font-size:9px;color:#888;padding:8px 12px">
    Pearson r: +1 = strong positive correlation, −1 = strong negative, 0 = no relationship. Based on ${wxPaired.length} days with both weather and productivity data.
  </div>
  ` : `
  ${sec('WEATHER × PRODUCTIVITY','#458588')}
  <div class="card"><p style="color:#aaa;font-size:10px">No weather data collected yet. Open Statistics → click Enable Weather to start tracking.</p></div>
  `}

  <div class="ftr"><span>FOCUSED · Productivity OS</span><span>Generated ${now.toISOString().replace('T',' ').slice(0,19)} UTC</span></div>
</div>

<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),600));<\/script>
</body></html>`;

  const win = window.open('', '_blank', 'width=860,height=940,scrollbars=yes');
  if (!win) { toast('⚠ Pop-ups blocked — allow pop-ups for PDF export', 'err'); return; }
  win.document.write(html);
  win.document.close();
}

$('openImportBtn').addEventListener('click',()=>{
  $('importFile').value=''; $('fileNameDisplay').textContent='Choose or drop a .json file…';
  $('importPreview').style.display='none'; $('importPreview').innerHTML='';
  hideErr('importFileErr','importFile'); openM('importModal');
});

// Drag-and-drop on import zone
const dropZone = $('fileDropZone');
if (dropZone) {
  ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      const dt = new DataTransfer(); dt.items.add(file);
      $('importFile').files = dt.files;
      $('importFile').dispatchEvent(new Event('change'));
    }
  });
}

$('importFile').addEventListener('change', function(){
  const file = this.files[0];
  if (!file) { $('fileNameDisplay').textContent='Choose or drop a .json file…'; $('importPreview').style.display='none'; return; }
  const kb = (file.size/1024).toFixed(1);
  $('fileNameDisplay').textContent = `${file.name}  (${kb} KB)`;
  // Quick preview parse
  const reader = new FileReader();
  reader.onload = e => { try {
    const data = JSON.parse(e.target.result);
    const hab = Array.isArray(data.habits) ? data.habits.length : '—';
    const ph  = data.pomoHistory ? Object.values(data.pomoHistory).reduce((s,v)=>s+v,0) : '—';
    const prev = $('importPreview');
    prev.style.display = 'grid';
    prev.innerHTML = `
      <div class="export-row"><span class="export-lbl">Time entries</span><span class="export-val">${(data.timeEntries||[]).length}</span></div>
      <div class="export-row"><span class="export-lbl">Projects</span><span class="export-val">${(data.projects||[]).length}</span></div>
      <div class="export-row"><span class="export-lbl">Goals</span><span class="export-val">${(data.goals||[]).length}</span></div>
      <div class="export-row"><span class="export-lbl">Habits</span><span class="export-val">${hab}</span></div>
      <div class="export-row"><span class="export-lbl">Pomodoros</span><span class="export-val">${ph}</span></div>
      ${data.exportedAt ? `<div class="export-row" style="grid-column:1/-1"><span class="export-lbl">Backup date</span><span class="export-val">${new Date(data.exportedAt).toLocaleDateString()}</span></div>` : ''}`;
  } catch(err) { $('importPreview').style.display='none'; } };
  reader.readAsText(file);
});
$('confirmImportBtn').addEventListener('click',()=>{
  const file=$('importFile').files[0];
  if(!file){ $('importFileErr').classList.add('show'); return; } $('importFileErr').classList.remove('show');
  const m=document.querySelector('input[name="importMode"]:checked').value;
  if(m==='replace'){
    const ok=confirm('⚠ This will permanently replace ALL your existing data with the backup.\n\nAre you sure?');
    if(!ok) return;
  }
  const reader=new FileReader();
  reader.onload=e=>{ try {
    const data=JSON.parse(e.target.result);
    if(!Array.isArray(data.timeEntries)||!Array.isArray(data.projects)) throw new Error('Invalid backup format');
    if(m==='replace'){
      timeEntries=data.timeEntries; goals=data.goals||[]; projects=data.projects;
      if(Array.isArray(data.habits)) localStorage.setItem('tt_hab',JSON.stringify(data.habits));
      if(data.habitCompletions) localStorage.setItem('tt_hc',JSON.stringify(data.habitCompletions));
      if(data.pomoHistory) localStorage.setItem('tt_ph',JSON.stringify(data.pomoHistory));
      save(); rerender(); habits=JSON.parse(localStorage.getItem('tt_hab')||'[]');
      toast('✓ Data replaced! Reload to see all changes.');
    } else {
      const merge=(a,b)=>{ const ids=new Set(a.map(x=>x.id)); return [...a,...b.filter(x=>!ids.has(x.id))]; };
      const newE=merge(timeEntries,data.timeEntries||[]);
      const newG=merge(goals,data.goals||[]);
      const newP=merge(projects,data.projects||[]);
      // Merge habits
      if(Array.isArray(data.habits)){
        const curHab=JSON.parse(localStorage.getItem('tt_hab')||'[]');
        localStorage.setItem('tt_hab',JSON.stringify(merge(curHab,data.habits)));
        habits=JSON.parse(localStorage.getItem('tt_hab'));
      }
      // Merge habit completions (union keys)
      if(data.habitCompletions){
        const cur=JSON.parse(localStorage.getItem('tt_hc')||'{}');
        Object.keys(data.habitCompletions).forEach(k=>{
          cur[k]=cur[k]?[...new Set([...cur[k],...(data.habitCompletions[k]||[])])]:data.habitCompletions[k];
        });
        localStorage.setItem('tt_hc',JSON.stringify(cur));
      }
      const added=newE.length-timeEntries.length;
      timeEntries=newE; goals=newG; projects=newP;
      save(); rerender();
      toast(`✓ Merged! +${added} new entries added.`);
    }
    closeM('importModal');
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

  // Month labels
  const mlEl = $('hmMonthLabels'); mlEl.innerHTML = '';
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

  // Day labels (Mon / Wed / Fri only)
  const dlEl = $('hmDayLabels'); dlEl.innerHTML = '';
  const dayLblSet = ['','Mon','','Wed','','Fri',''];
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

  // Stats — scoped to the displayed year range
  const streaks = hmStreaks(dayMap);
  const bestHour = hmBestHour();
  let rangePomos = 0, rangeMs = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    const k = d.toISOString().slice(0,10);
    if (dayMap[k]) { rangePomos += dayMap[k].pomos; rangeMs += dayMap[k].ms; }
  }
  const totalHrs = (rangeMs/3600000).toFixed(1);

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
      <div class="hm-stat-sub">this year</div>
    </div>
    <div class="hm-stat pomo">
      <div class="hm-stat-val">${rangePomos}</div>
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
    last7.push({ label: HM_DAYS[d.getDay()].slice(0,3), ms: dayMap[k]?.ms || 0, isToday: i===0 });
  }
  const maxDay = Math.max(...last7.map(d=>d.ms), 1);
  trendEl.innerHTML = `<div class="hm-trend-title">LAST 7 DAYS</div>` +
    last7.map(d => {
      const hrs = d.ms > 0 ? (d.ms/3600000).toFixed(1)+'h' : '—';
      const pct = Math.round((d.ms/maxDay)*100);
      return `<div class="hm-bar-row${d.isToday?' hm-bar-today':''}">
        <div class="hm-bar-lbl">${d.label}</div>
        <div class="hm-bar-track"><div class="hm-bar-fill" style="width:${pct}%"></div></div>
        <div class="hm-bar-val">${hrs}</div>
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
    const isFuture=d>today;
    const isSel=k===habKey(habViewDate);
    const scheduled=habits.filter(h=>!h.archived&&habIsScheduled(h,d));
    const done=scheduled.filter(h=>(c[k]||[]).includes(h.id)).length;
    const btn=document.createElement('div');
    btn.className='hab-day-btn'+(isToday?' today':'')+(isSel?' selected':'')+(isFuture?' future':'');
    const dotHtml=scheduled.slice(0,6).map(h=>`<div class="hab-day-dot" style="width:4px;height:4px;border-radius:50%;background:${(c[k]||[]).includes(h.id)?h.color||'var(--green-b)':'var(--bg2)'}"></div>`).join('');
    btn.innerHTML=`<div class="hab-day-name">${DAY_NAMES[d.getDay()]}</div><div class="hab-day-num">${d.getDate()}</div><div class="hab-day-dots">${dotHtml}</div>`;
    btn.addEventListener('click',()=>{habViewDate=new Date(d);renderHabitsModal();});
    strip.appendChild(btn);
  }
  // Disable fwd arrow when already showing up to today
  const fwdBtn=document.getElementById('habDateFwd');
  if(fwdBtn) fwdBtn.disabled = habStripOffset >= 0;
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
  if(!scheduled.length){
    const hasAny=habits.filter(h=>!h.archived).length > 0;
    list.innerHTML=`<div class="hab-empty"><span class="hab-empty-icon">🌱</span>${
      hasAny ? 'No habits scheduled for this day.<br><span style="font-size:10px;opacity:.6">Check the day\'s schedule or add a new habit below.</span>'
              : 'No habits yet.<br><span style="font-size:10px;opacity:.6">Add your first habit using the form below!</span>'
    }</div>`;
  } else if(!filtered.length){
    list.innerHTML=`<div class="hab-empty"><span class="hab-empty-icon">🔍</span>No habits match the <strong>${habCatFilter}</strong> filter.</div>`;
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
    if(!confirm(`Archive "${h.name}"?\nIt will be hidden but its history is kept.`)) return;
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
  habStripOffset=0;
  document.querySelectorAll('.hab-tab').forEach(t=>t.classList.toggle('on',t.dataset.view==='today'));
  renderHabitsModal(); openM('habitsModal');
  // auto-focus the add-habit name field after transition
  setTimeout(()=>{
    const nameEl=document.getElementById('habAddName');
    if(nameEl) nameEl.focus();
  }, 250);
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
  const gaps    = tlnFindGaps(entries);  // compute once
  const allItems = [...entries, ...gaps].sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const totalMs  = entries.reduce((s,e)=>s+e.durationMs,0);
  const totalSec = Math.round(totalMs/1000);

  // Disable "next" when already on today or future
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
  const viewMidnight  = new Date(tlnViewDate); viewMidnight.setHours(0,0,0,0);
  $('tlnNext').disabled  = viewMidnight >= todayMidnight;
  $('tlnToday').disabled = viewMidnight >= todayMidnight;

  document.getElementById('tlnDateLbl').textContent = tlnViewDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

  // Stats bar
  const earliestE = entries[0];
  const latestE   = entries[entries.length-1];
  document.getElementById('tlnStats').innerHTML = `
    <div class="tln-stat"><span class="tln-stat-val">${entries.length}</span>&nbsp;session${entries.length!==1?'s':''}</div>
    <div class="tln-stat"><span class="tln-stat-val">${fmtHuman(totalSec)}</span>&nbsp;tracked</div>
    ${earliestE ? `<div class="tln-stat"><span class="tln-stat-val">${tlnFmtTime(earliestE.startTime)}</span>&nbsp;first focus</div>` : ''}
    ${latestE   ? `<div class="tln-stat"><span class="tln-stat-val">${tlnFmtTime(latestE.endTime)}</span>&nbsp;last stop</div>` : ''}
    <div class="tln-stat"><span class="tln-stat-val">${gaps.length}</span>&nbsp;idle gap${gaps.length!==1?'s':''}</div>`;

  const wrap = document.getElementById('tlnWrap'); wrap.innerHTML = '';

  if (!allItems.length) {
    const isEmpty = viewMidnight < todayMidnight;
    wrap.innerHTML = `<div class="tln-empty">${isEmpty ? '// no activity recorded for this day' : '// start a session to see it here'}</div>`;
    return;
  }

  if (tlnView === 'timeline') {
    const line = document.createElement('div'); line.className = 'tln-line';
    allItems.forEach(item => {
      const col  = projColor(item.projectId);
      const slot = document.createElement('div'); slot.className = 'tln-slot';
      slot.innerHTML = `
        <div class="tln-time">${tlnFmtTime(item.startTime)}</div>
        <div class="tln-gutter"><div class="tln-dot" style="background:${item.isIdle ? 'var(--bg3)' : col}"></div></div>
        <div class="tln-block-wrap">
          <div class="tln-block ${item.isIdle ? 'idle' : 'entry'}" style="${item.isIdle ? '' : 'background:'+col+'22;border-left:2px solid '+col+';'}">
            <div class="tln-block-title">${escHtml(item.task || item.projectName || 'Focus')}</div>
            <div class="tln-block-meta">${tlnFmtTime(item.startTime)} → ${tlnFmtTime(item.endTime)} · ${tlnDurFmt(item.durationMs)}${item.projectName && !item.isIdle ? ' · '+item.projectName : ''}${item.isIdle ? ' <span class="tln-idle-badge">idle</span>' : ''}</div>
          </div>
        </div>`;
      line.appendChild(slot);
    });
    wrap.appendChild(line);

  } else if (tlnView === 'blocks') {
    if (!entries.length) { wrap.innerHTML = '<div class="tln-empty">// no entries for this day</div>'; return; }
    // Use actual activity window (first start → last end) not full day
    const winStart = new Date(entries[0].startTime);
    const winEnd   = new Date(entries[entries.length-1].endTime || entries[entries.length-1].startTime);
    winEnd.setMinutes(winEnd.getMinutes() + 30); // add padding
    const winMs = Math.max(winEnd - winStart, 1);
    const bv = document.createElement('div'); bv.className = 'tln-blocks-view';
    entries.forEach(e => {
      const left  = ((new Date(e.startTime) - winStart) / winMs) * 100;
      const width = Math.max(0.8, (e.durationMs / winMs) * 100);
      const col   = projColor(e.projectId);
      const b = document.createElement('div'); b.className = 'tln-bv-block';
      b.style.cssText = `left:${left}%;width:${width}%;background:${col};`;
      b.textContent = width > 4 ? escHtml(e.task || 'Focus') : '';
      b.title = `${e.task||'Focus'} · ${tlnFmtTime(e.startTime)}–${tlnFmtTime(e.endTime)} · ${tlnDurFmt(e.durationMs)}`;
      bv.appendChild(b);
    });
    wrap.appendChild(bv);
    // Time axis using activity window
    const axis = document.createElement('div'); axis.className = 'tln-density-labels';
    axis.style.marginTop = '4px';
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const t = new Date(winStart.getTime() + (winMs * i / tickCount));
      axis.innerHTML += `<span>${tlnFmtTime(t)}</span>`;
    }
    wrap.appendChild(axis);

  } else { // density — proportional minute-by-minute distribution
    const hourMs = new Array(24).fill(0);
    entries.forEach(e => {
      const st = new Date(e.startTime), en = new Date(e.endTime || e.startTime);
      const totalMin = Math.max(1, (en - st) / 60000);
      // Walk minute by minute and accumulate per-hour
      for (let m = 0; m < totalMin; m++) {
        const t = new Date(st.getTime() + m * 60000);
        hourMs[t.getHours()] += (e.durationMs / totalMin);
      }
    });
    const maxH = Math.max(...hourMs, 1);
    const graph = document.createElement('div'); graph.className = 'tln-density';
    hourMs.forEach((ms, h) => {
      const bar = document.createElement('div'); bar.className = 'tln-density-bar';
      const pct = Math.round((ms / maxH) * 100);
      bar.style.cssText = `height:${Math.max(ms>0?3:1,pct)}%;background:rgba(131,165,152,${ms>0 ? 0.2 + pct/100*0.8 : 0.08});`;
      bar.title = `${String(h).padStart(2,'0')}:00 · ${ms > 0 ? tlnDurFmt(ms) : 'no activity'}`;
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    if (document.getElementById('terminalModal').classList.contains('open')) return;
    e.preventDefault();
    cmdOverlay.classList.contains('open') ? cmdClose() : cmdOpen();
  }
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
// ============================================================

// ============================================================
// === TERMINAL ===============================================
// ============================================================
const termModal   = document.getElementById('terminalModal');
const termOutput  = document.getElementById('termOutput');
const termInputEl = document.getElementById('termInput');
const termWin     = document.getElementById('termWindow');

let termHistory   = [];
let termHistIdx   = -1;
let termOpen      = false;
let termCwd       = '~/focus';

// ── Helpers ────────────────────────────────────────────────
const termLine = (text, cls = 'tl-out') => {
  const d = document.createElement('div');
  d.className = `term-line ${cls}`;
  d.innerHTML = text;
  termOutput.appendChild(d);
  termOutput.scrollTop = termOutput.scrollHeight;
};
const termBlank = () => { const d = document.createElement('div'); d.className = 'term-line tl-empty'; termOutput.appendChild(d); };
const termPs1Echo = (cmd) => {
  const d = document.createElement('div');
  d.className = 'term-line tl-cmd';
  d.innerHTML = `<span class="tp-user">focus</span><span class="tp-at">@</span><span class="tp-host">local</span><span class="tp-sep">:</span><span class="tp-dir">${termCwd}</span><span class="tp-dollar"> $</span>${escHtml(cmd)}`;
  termOutput.appendChild(d);
  termOutput.scrollTop = termOutput.scrollHeight;
};
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtSz   = b => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}K` : `${(b/1048576).toFixed(1)}M`;
const lsUsed  = () => { let t=0; for(const k of Object.keys(localStorage)) t+=(localStorage.getItem(k)||'').length*2; return t; };
const ruler   = (ch='─', n=44) => ch.repeat(n);

// ── Boot banner ────────────────────────────────────────────
// ── Shared auto-scaling ASCII logo ─────────────────────────
// FOCUSED in standard figlet ASCII (5 rows, pure ASCII chars)
const ASCII_LOGO_ROWS = [
  [' _____  ___    ____  _   _  ____  _____  ____ ',  '#fabd2f'],
  ['|  ___| / _ \\  / ___|| | | |/ ___||  ___||  _ \\ ', '#fabd2f'],
  ['| |_   | | | || |    | | | |\\___ \\|  _|  | | | |','#fe8019'],
  ['|  _|  | |_| || |___ | |_| | ___) || |___| |_| |', '#fe8019'],
  ['|_|     \\___/  \\____|  \\___/  |____/ |_____|____/ ', '#d65d0e'],
];

// Creates a scaled logo <div>. Measures actual render width and applies
// CSS transform to fit the available container width.
const _mkLogo = () => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'transform-origin:left top;white-space:pre;line-height:1.3;margin-bottom:2px;';
  ASCII_LOGO_ROWS.forEach(([text, color]) => {
    const ln = document.createElement('div');
    ln.style.cssText = `color:${color};font-family:'JetBrains Mono',monospace;font-size:12.5px;`;
    ln.textContent = text;
    wrap.appendChild(ln);
  });
  // Scale after DOM paints
  requestAnimationFrame(() => {
    const avail  = termOutput.clientWidth - 8;
    const actual = wrap.scrollWidth;
    if (actual > avail && avail > 0) {
      const ratio = avail / actual;
      wrap.style.transform = `scale(${ratio})`;
      // collapse the visual height so it doesn't leave a gap
      wrap.style.marginBottom = `${-(wrap.scrollHeight * (1 - ratio))}px`;
    }
  });
  return wrap;
};

const termBoot = () => {
  termOutput.innerHTML = '';
  const now = new Date();
  termOutput.appendChild(_mkLogo());
  termBlank();
  termLine(`<span style="color:#665c54">  ${now.toDateString()}  ${now.toLocaleTimeString()}  ·  ${timeEntries.length} entries  ·  ${fmt(timeEntries.reduce((s,e)=>s+(e.durationMs||0),0))} total</span>`);
  termLine(`<span style="color:#665c54">  type <span style="color:#8ec07c">help</span> for commands  ·  <span style="color:#8ec07c">Tab</span> autocomplete  ·  <span style="color:#8ec07c">↑↓</span> history</span>`);
  termBlank();
};

// ── Open / close ────────────────────────────────────────────
const termOpenFn = () => {
  termModal.classList.add('open');
  termOpen = true;
  if (!termOutput.children.length) termBoot();
  setTimeout(() => termInputEl.focus(), 40);
};
const termCloseFn = () => {
  termModal.classList.remove('open');
  termOpen = false;
};

document.getElementById('termCloseBtn').addEventListener('click', termCloseFn);
document.getElementById('openTermBtn').addEventListener('click', termOpenFn);
termModal.addEventListener('click', e => { if (e.target === termModal) termCloseFn(); });
termWin.addEventListener('click', () => termInputEl.focus());

// ── Command registry ────────────────────────────────────────
const TERM_CMDS = {};
const reg = (names, fn, meta = {}) => {
  (Array.isArray(names) ? names : [names]).forEach(n => TERM_CMDS[n] = { fn, ...meta });
};

// help
reg('help', ({ args }) => {
  const target = args[0];

  // ── help <cmd> ────────────────────────────────────────────
  if (target) {
    const entry = TERM_CMDS[target];
    if (!entry) { termLine(`  <span style="color:#fb4934">No manual entry for '<strong>${escHtml(target)}</strong>'</span>`,'tl-err'); return; }
    termBlank();
    termLine(`  <span style="color:#fabd2f;font-weight:700">${escHtml(target)}</span>  <span style="color:#a89984">${entry.desc||'—'}</span>`);
    if (entry.usage) termLine(`  <span style="color:#665c54">usage:</span>  <span style="color:#8ec07c">${escHtml(entry.usage)}</span>`);
    termBlank(); return;
  }

  // ── Full help ─────────────────────────────────────────────
  const W = 60;
  const bar  = c => `  <span style="color:#3c3836">${'─'.repeat(W)}</span>`;
  const sec  = (title, col='#d3869b') => {
    const pad = Math.max(0, W - title.length - 2);
    return `  <span style="color:${col};font-weight:700;letter-spacing:.3px">${title}</span>  <span style="color:#3c3836">${'─'.repeat(pad)}</span>`;
  };
  const row  = (cmd, desc, indent=2) => {
    const sp = Math.max(2, 30 - indent - cmd.length);
    return `${' '.repeat(indent)}<span style="color:#8ec07c">${escHtml(cmd)}</span>${' '.repeat(sp)}<span style="color:#a89984">${escHtml(desc)}</span>`;
  };
  const row2 = (c1, d1, c2, d2) => {
    const sp1 = Math.max(2, 22 - c1.length);
    const sp2 = Math.max(2, 18 - d1.length);
    return `  <span style="color:#8ec07c">${escHtml(c1)}</span>${' '.repeat(sp1)}<span style="color:#a89984">${escHtml(d1)}</span>${' '.repeat(sp2)}<span style="color:#458588">${escHtml(c2)}</span>  <span style="color:#665c54">${escHtml(d2)}</span>`;
  };
  const dim  = t => `  <span style="color:#504945">${escHtml(t)}</span>`;

  termBlank();
  termLine(`  <span style="color:#504945">${'─'.repeat(Math.floor((W-14)/2))} FOCUSED TERM ${'─'.repeat(Math.ceil((W-14)/2))}</span>`,'tl-head');
  termBlank();

  termLine(sec('TRACKING','#b8bb26'));
  termLine(row('track <task> [#project]', 'Start time tracking'));
  termLine(row('stop',                    'Stop current session'));
  termLine(row('pause  /  resume',        'Toggle pause on session'));
  termLine(row('status',                  'Live status + today total'));
  termBlank();

  termLine(sec('DATA','#fe8019'));
  termLine(row('add <task> <dur> [#proj]','Log manual entry  (e.g. 1h30m, 45m)'));
  termLine(row('entries [yesterday|date]','List entries for a day'));
  termLine(row('total [today|week|month]','Tracked time summary + breakdown'));
  termLine(row('delete <index>',          'Remove a today entry by index'));
  termLine(row('note <text>',             'Save timestamped note'));
  termBlank();

  termLine(sec('POMODORO','#fb4934'));
  termLine(row2('start / pause / reset', 'Timer controls', 'skip',  'Skip session'));
  termLine(row2('work / short / long',   'Switch mode',    'pomo',  'Session log'));
  termBlank();

  termLine(sec('HABITS & GOALS','#b8bb26'));
  termLine(row2('habit list',   'Today\'s schedule', 'habit done <name>', 'Mark complete'));
  termLine(row2('goal',         'Goal progress',    'project',           'Project stats'));
  termBlank();

  termLine(sec('PANELS','#83a598'));
  termLine(row('open <name>',    'Open any panel by name'));
  termLine(dim('  names: stats · heatmap · reports · timeline · habits · import · export'));
  termBlank();

  termLine(sec('TOOLS','#d3869b'));
  termLine(row2('keys / shortcuts', 'Keyboard ref',  'weather',   'Current conditions'));
  termLine(row2('statsum',          'Text stats',    'neofetch',  'System info'));
  termLine(row2('history',          'Cmd history',   'man <cmd>', 'Command manual'));
  termLine(row2('find <query>',     'Search entries','today',     'Today summary'));
  termLine(row2('clear',            'Clear terminal','exit',      'Close terminal'));
  termBlank();

  termLine(`  <span style="color:#504945">${'─'.repeat(W)}</span>`);
  termLine(`  <span style="color:#665c54">help <cmd></span>  <span style="color:#3c3836">detailed usage</span>  <span style="color:#504945">·</span>  <span style="color:#665c54">Tab</span>  <span style="color:#3c3836">autocomplete</span>  <span style="color:#504945">·</span>  <span style="color:#665c54">↑↓</span>  <span style="color:#3c3836">history</span>`);
  termBlank();
}, { desc:'Show available commands', usage:'help [command]' });

// ── Timer commands ──────────────────────────────────────────
reg('start', ({ args }) => {
  if (!pomoRunning) $('pomoStart').click();
  termLine(`  <span style="color:#b8bb26">✓</span> <span style="color:#a89984">timer started — ${mode.toUpperCase()} · ${fmtMS(pomoSec)} remaining</span>`);
}, { desc:'Start the pomodoro timer' });

reg('pause', () => {
  if (pomoRunning) $('pomoStart').click();
  termLine(`  <span style="color:#fabd2f">⏸</span> <span style="color:#a89984">timer paused at ${fmtMS(pomoSec)}</span>`);
}, { desc:'Pause the pomodoro timer' });

reg('reset', () => {
  $('pomoReset').click();
  termLine(`  <span style="color:#fabd2f">↺</span> <span style="color:#a89984">timer reset to ${fmtMS(pomoSettings[mode])}</span>`);
}, { desc:'Reset current session' });

reg('skip', () => {
  $('pomoSkip').click();
  termLine(`  <span style="color:#83a598">⏭</span> <span style="color:#a89984">skipped to next session</span>`);
}, { desc:'Skip to the next session' });

// mode switchers
['work','short','long'].forEach(m => {
  reg(m, () => {
    document.querySelector(`.pomo-tab[data-m="${m}"]`).click();
    termLine(`  <span style="color:#8ec07c">→</span> <span style="color:#a89984">mode set to <b>${m.toUpperCase()}</b></span>`);
  }, { desc:`Switch to ${m} mode` });
});

// ── Data / status commands ──────────────────────────────────
reg('status', () => {
  const now = new Date();
  const todayMs = timeEntries.filter(e=>sameDay(new Date(e.startTime),now)).reduce((s,e)=>s+(e.durationMs||0),0);
  termBlank();
  termLine(`<span style="color:#665c54">  ${ruler()}</span>`);
  const pomoState = pomoRunning
    ? `<span style="color:#b8bb26">RUNNING</span>`
    : `<span style="color:#665c54">PAUSED</span>`;
  const trackState = taskRunning
    ? `<span style="color:#b8bb26">● ${escHtml(activeEntry?.task || 'tracking')}</span>`
    : `<span style="color:#665c54">idle</span>`;
  termLine(`  <span style="color:#a89984">timer   </span><span style="color:#ebdbb2">${mode.toUpperCase()} ${fmtMS(pomoSec)}</span>  ${pomoState}`);
  termLine(`  <span style="color:#a89984">tracker </span>${trackState}`);
  termLine(`  <span style="color:#a89984">today   </span><span style="color:#fabd2f">${fmt(todayMs)}</span>  <span style="color:#665c54">${timeEntries.filter(e=>sameDay(new Date(e.startTime),now)).length} entries</span>`);
  termLine(`  <span style="color:#a89984">sessions</span><span style="color:#ebdbb2">${sessionsD}</span> completed`);
  termLine(`<span style="color:#665c54">  ${ruler()}</span>`);
  termBlank();
}, { desc:'Show live timer and tracker status' });

reg(['statsum','summary'], () => {
  const todayE  = timeEntries.filter(e=>sameDay(new Date(e.startTime),now));
  const weekE   = timeEntries.filter(e=>sameWeek(new Date(e.startTime),now));
  const monthE  = timeEntries.filter(e=>sameMon(new Date(e.startTime),now));
  // avg per tracked day
  const days = new Set(timeEntries.map(e=>new Date(e.startTime).toDateString()));
  const avg  = days.size ? Math.round(sum(timeEntries)/days.size) : 0;
  termBlank();
  termLine(`<span style="color:#d3869b">── statistics ─────────────────────────────</span>`,'tl-head');
  [
    ['today',      fmt(sum(todayE)),  `${todayE.length} entries`],
    ['this week',  fmt(sum(weekE)),   `${weekE.length} entries`],
    ['this month', fmt(sum(monthE)),  `${monthE.length} entries`],
    ['all time',   fmt(sum(timeEntries)), `${timeEntries.length} entries`],
    ['daily avg',  fmt(avg),          `over ${days.size} days`],
  ].forEach(([lbl,val,sub]) => {
    termLine(`  <span style="color:#a89984">${lbl.padEnd(12)}</span><span style="color:#fabd2f">${val.padEnd(12)}</span><span style="color:#665c54">${sub}</span>`);
  });
  termLine(`  <span style="color:#a89984">projects</span>    <span style="color:#ebdbb2">${projects.length}</span>`);
  termLine(`  <span style="color:#a89984">goals</span>       <span style="color:#ebdbb2">${goals.length}</span>`);
  termBlank();
}, { desc:'Detailed time statistics' });

reg(['today'], () => {
  const now = new Date();
  const entries = timeEntries.filter(e=>sameDay(new Date(e.startTime),now));
  const total   = entries.reduce((s,e)=>s+(e.durationMs||0),0);
  termBlank();
  termLine(`<span style="color:#d3869b">── today · ${now.toDateString()} ──────────────────</span>`,'tl-head');
  if (!entries.length) { termLine(`  <span style="color:#665c54">no entries yet</span>`); termBlank(); return; }
  entries.forEach((e,i)=>{
    const proj = projects.find(p=>p.id===e.projectId);
    termLine(`  <span style="color:#665c54">${String(i+1).padStart(2)}.</span> <span style="color:#ebdbb2">${escHtml(e.task||'?')}</span>  <span style="color:#fabd2f">${fmt(e.durationMs||0)}</span>${proj?`  <span style="color:#83a598">${escHtml(proj.name)}</span>`:''}`);
  });
  termLine(`<span style="color:#665c54">  ${'─'.repeat(44)}</span>`);
  termLine(`  <span style="color:#a89984">total</span>  <span style="color:#fabd2f">${fmt(total)}</span>  <span style="color:#665c54">${entries.length} entries</span>`);
  termBlank();
}, { desc:"Show today's entries and total" });

reg('week', () => {
  const now = new Date();
  const entries = timeEntries.filter(e=>sameWeek(new Date(e.startTime),now));
  const total = entries.reduce((s,e)=>s+(e.durationMs||0),0);
  // group by day
  const byDay = {};
  entries.forEach(e => {
    const d = new Date(e.startTime).toDateString();
    byDay[d] = (byDay[d]||0) + (e.durationMs||0);
  });
  termBlank();
  termLine(`<span style="color:#d3869b">── this week ──────────────────────────────</span>`,'tl-head');
  Object.entries(byDay).forEach(([d,ms]) => {
    const pct = Math.round(ms/Math.max(...Object.values(byDay))*20);
    const bar = '█'.repeat(pct) + '░'.repeat(20-pct);
    termLine(`  <span style="color:#a89984">${d.slice(0,10)}</span>  <span style="color:#83a598">${bar}</span>  <span style="color:#fabd2f">${fmt(ms)}</span>`);
  });
  termLine(`<span style="color:#665c54">  ${'─'.repeat(44)}</span>`);
  termLine(`  <span style="color:#a89984">week total</span>  <span style="color:#fabd2f">${fmt(total)}</span>  <span style="color:#665c54">${entries.length} entries</span>`);
  termBlank();
}, { desc:'Weekly breakdown by day' });

// ── Entry browsing ──────────────────────────────────────────
reg(['ls', 'tasks'], ({ args }) => {
  const limit = parseInt(args[0]) || 10;
  const all   = args.includes('--all') || args.includes('-a');
  const entries = all ? timeEntries : timeEntries.filter(e=>sameDay(new Date(e.startTime),new Date()));
  const show  = entries.slice(-limit);
  termBlank();
  termLine(`<span style="color:#d3869b">── ${all?`last ${limit} entries`:"today's entries"} ──────────────────────</span>`,'tl-head');
  if (!show.length) { termLine(`  <span style="color:#665c54">no entries</span>`); termBlank(); return; }
  show.forEach((e,i) => {
    const proj = projects.find(p=>p.id===e.projectId);
    const d    = new Date(e.startTime);
    const ts   = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    termLine(`  <span style="color:#665c54">${ts}</span>  <span style="color:#ebdbb2">${escHtml(e.task||'—')}</span>  <span style="color:#fabd2f">${fmt(e.durationMs||0)}</span>${proj?`  <span style="color:#83a598">${escHtml(proj.name)}</span>`:''}`);
  });
  termBlank();
}, { desc:'List entries (today by default)', usage:'ls [n] [--all]' });

reg(['find','grep'], ({ args }) => {
  const q = args.join(' ').toLowerCase().trim();
  if (!q) { termLine(`  usage: find &lt;keyword&gt;`,'tl-err'); return; }
  const hits = timeEntries.filter(e => (e.task||'').toLowerCase().includes(q));
  termBlank();
  termLine(`<span style="color:#d3869b">── find "${escHtml(q)}" — ${hits.length} result(s) ──────────</span>`,'tl-head');
  if (!hits.length) { termLine(`  <span style="color:#665c54">no matches</span>`); termBlank(); return; }
  hits.slice(-20).forEach(e => {
    const proj = projects.find(p=>p.id===e.projectId);
    const d    = new Date(e.startTime).toLocaleDateString();
    const hl   = escHtml(e.task).replace(new RegExp(escHtml(q),'gi'), m=>`<span style="color:#fabd2f;font-weight:700">${m}</span>`);
    termLine(`  <span style="color:#665c54">${d}</span>  ${hl}  <span style="color:#83a598">${fmt(e.durationMs||0)}</span>`);
  });
  if (hits.length > 20) termLine(`  <span style="color:#665c54">... ${hits.length-20} more not shown</span>`);
  termBlank();
}, { desc:'Search entries by keyword', usage:'find <keyword>' });

// ── Projects / goals ────────────────────────────────────────
reg(['projects','proj'], () => {
  if (!projects.length) { termLine(`  <span style="color:#665c54">no projects — create one with the + button</span>`); return; }
  termBlank();
  termLine(`<span style="color:#d3869b">── projects ───────────────────────────────</span>`,'tl-head');
  const sorted = [...projects].map(p => ({
    ...p,
    total: timeEntries.filter(e=>e.projectId===p.id).reduce((s,e)=>s+(e.durationMs||0),0),
    count: timeEntries.filter(e=>e.projectId===p.id).length,
  })).sort((a,b)=>b.total-a.total);
  const maxT = Math.max(...sorted.map(p=>p.total),1);
  sorted.forEach((p,i) => {
    const bar = '█'.repeat(Math.round(p.total/maxT*16))+'░'.repeat(16-Math.round(p.total/maxT*16));
    const col = PROJ_COLORS[i%PROJ_COLORS.length];
    termLine(`  <span style="color:${col}">●</span> <span style="color:#ebdbb2">${escHtml(p.name).padEnd(20)}</span><span style="color:#83a598">${bar}</span>  <span style="color:#fabd2f">${fmt(p.total)}</span>  <span style="color:#665c54">${p.count} entries</span>`);
  });
  termBlank();
}, { desc:'List projects with time totals' });

reg('goals', () => {
  if (!goals.length) { termLine(`  <span style="color:#665c54">no goals — create one with the + button</span>`); return; }
  const now = new Date();
  termBlank();
  termLine(`<span style="color:#d3869b">── goals ──────────────────────────────────</span>`,'tl-head');
  goals.forEach(g => {
    const relevant = timeEntries.filter(e => {
      if (g.projectId && e.projectId!==g.projectId) return false;
      const d = new Date(e.startTime);
      return g.freq==='day' ? sameDay(d,now) : g.freq==='week' ? sameWeek(d,now) : sameMon(d,now);
    });
    const done   = relevant.reduce((s,e)=>s+(e.durationMs||0),0)/1000;
    const target = g.targetSecs||3600;
    const pct    = Math.min(100, Math.round(done/target*100));
    const filled = Math.round(pct/5);
    const bar    = `${'█'.repeat(filled)}${'░'.repeat(20-filled)}`;
    const col    = pct>=100?'#b8bb26':pct>=50?'#fabd2f':'#fb4934';
    termLine(`  <span style="color:#ebdbb2">${escHtml(g.name)}</span>  <span style="color:#665c54">${g.type==='atLeast'?'≥':'≤'} ${fmt(target*1000)} /${g.freq}</span>`);
    termLine(`  <span style="color:${col}">${bar}</span>  <span style="color:${col}">${pct}%</span>  <span style="color:#665c54">${fmt(done*1000)} done</span>`);
    termBlank();
  });
}, { desc:'Show goal progress' });

// ── Session / pomo ──────────────────────────────────────────
reg('pomo', () => {
  termBlank();
  termLine(`<span style="color:#d3869b">── pomodoro ───────────────────────────────</span>`,'tl-head');
  termLine(`  <span style="color:#a89984">mode      </span><span style="color:#ebdbb2">${mode.toUpperCase()}</span>  ${pomoRunning?'<span style="color:#b8bb26">running</span>':'<span style="color:#665c54">paused</span>'}`);
  termLine(`  <span style="color:#a89984">remaining </span><span style="color:#fabd2f">${fmtMS(pomoSec)}</span>  <span style="color:#665c54">of ${fmtMS(pomoSettings[mode])}</span>`);
  termLine(`  <span style="color:#a89984">sessions  </span><span style="color:#ebdbb2">${sessionsD}</span> today`);
  termLine(`  <span style="color:#a89984">auto-adv  </span><span style="color:#ebdbb2">${pomoSettings.autoAdv?'on':'off'}</span>`);
  termLine(`  <span style="color:#a89984">work      </span><span style="color:#ebdbb2">${Math.floor(pomoSettings.work/60)}m</span>  <span style="color:#a89984">short</span> <span style="color:#ebdbb2">${Math.floor(pomoSettings.short/60)}m</span>  <span style="color:#a89984">long</span> <span style="color:#ebdbb2">${Math.floor(pomoSettings.long/60)}m</span>`);
  termBlank();
}, { desc:'Show pomodoro state and settings' });

reg('log', () => {
  if (!pomoLog.length) { termLine(`  <span style="color:#665c54">no sessions logged today</span>`); return; }
  termBlank();
  termLine(`<span style="color:#d3869b">── session log · today ────────────────────</span>`,'tl-head');
  pomoLog.forEach((s,i) => {
    const col = s.mode==='work'?'#fb4934':s.mode==='short'?'#b8bb26':'#83a598';
    termLine(`  <span style="color:#665c54">${String(i+1).padStart(2)}.</span>  <span style="color:${col}">${(s.mode||'?').padEnd(7)}</span><span style="color:#fabd2f">${fmtMS(s.duration||0)}</span>  <span style="color:#665c54">${s.ts||''}</span>`);
  });
  const workCount = pomoLog.filter(s=>s.mode==='work').length;
  termLine(`  <span style="color:#665c54">─── ${workCount} work · ${pomoLog.length-workCount} break</span>`);
  termBlank();
}, { desc:"Show today's pomodoro session log" });

reg('top', () => {
  const now = new Date();
  const todayMs = timeEntries.filter(e=>sameDay(new Date(e.startTime),now)).reduce((s,e)=>s+(e.durationMs||0),0);
  termBlank();
  termLine(`<span style="color:#d3869b">── top — focus processes ──────────────────</span>`,'tl-head');
  termLine(`  <span style="color:#665c54">PID   TASK                        TIME      STATE</span>`);
  termLine(`<span style="color:#665c54">  ${ruler()}</span>`);
  if (taskRunning && activeEntry) {
    const el = Date.now() - (taskStart?.getTime()||Date.now());
    termLine(`  <span style="color:#fabd2f">0001  ${escHtml((activeEntry.task||'?').slice(0,28)).padEnd(28)}  ${fmt(el)}  <span style="color:#b8bb26">running</span></span>`);
  }
  termLine(`  <span style="color:#83a598">0002  pomodoro-timer              ${fmtMS(pomoSec).padEnd(8)}  ${pomoRunning?'<span style="color:#b8bb26">running</span>':'<span style="color:#665c54">sleeping</span>'}</span>`);
  termLine(`  <span style="color:#a89984">0003  storage-sync                background  <span style="color:#665c54">idle</span></span>`);
  termLine(`  <span style="color:#a89984">0004  weather-poller              10min       <span style="color:#665c54">idle</span></span>`);
  termLine(`<span style="color:#665c54">  ${'─'.repeat(44)}</span>`);
  termLine(`  <span style="color:#665c54">today: ${fmt(todayMs)}  ·  ${sessionsD} sessions  ·  mem: ${fmtSz(lsUsed())}</span>`);
  termBlank();
}, { desc:'Show running processes / active tasks' });

// ── System commands ─────────────────────────────────────────
reg('env', () => {
  termBlank();
  termLine(`<span style="color:#d3869b">── environment ────────────────────────────</span>`,'tl-head');
  [
    ['WORK_MINS',    String(Math.floor(pomoSettings.work/60))],
    ['SHORT_MINS',   String(Math.floor(pomoSettings.short/60))],
    ['LONG_MINS',    String(Math.floor(pomoSettings.long/60))],
    ['CYCLE',        String(pomoSettings.cycle||4)],
    ['AUTO_ADV',     pomoSettings.autoAdv?'1':'0'],
    ['POMO_GOAL',    String(pomoGoalTarget)],
    ['ENTRIES',      String(timeEntries.length)],
    ['PROJECTS',     String(projects.length)],
    ['GOALS',        String(goals.length)],
    ['CLOCK_MODE',   hwState?.is24h?'24h':'12h'],
  ].forEach(([k,v]) => termLine(`  <span style="color:#83a598">${k.padEnd(16)}</span><span style="color:#ebdbb2">=${v}</span>`));
  termBlank();
}, { desc:'Show current settings and environment' });

reg('df', () => {
  const used  = lsUsed();
  const quota = 5 * 1024 * 1024; // 5MB typical
  const pct   = Math.round(used/quota*100);
  const filled= Math.round(pct/5);
  termBlank();
  termLine(`<span style="color:#d3869b">── storage usage ──────────────────────────</span>`,'tl-head');
  termLine(`  <span style="color:#a89984">Filesystem   Size    Used    Avail   Use%</span>`);
  termLine(`  <span style="color:#665c54">${'─'.repeat(44)}</span>`);
  termLine(`  <span style="color:#ebdbb2">localStorage </span><span style="color:#a89984">5.0M</span>    <span style="color:#fabd2f">${fmtSz(used).padEnd(8)}</span><span style="color:#a89984">${fmtSz(quota-used).padEnd(8)}</span><span style="color:${pct>80?'#fb4934':'#b8bb26'}">${pct}%</span>`);
  termLine(`  <span style="color:#83a598">${'█'.repeat(filled)}${'░'.repeat(20-filled)}</span>  <span style="color:#665c54">${fmtSz(used)} / ${fmtSz(quota)}</span>`);
  termLine(`  <span style="color:#665c54">  entries: ${fmtSz(JSON.stringify(timeEntries).length*2)}  ·  settings: ${fmtSz(JSON.stringify(pomoSettings).length*2)}</span>`);
  termBlank();
}, { desc:'Show localStorage usage' });

reg('uptime', () => {
  const since = window._appStart || new Date();
  const secs  = Math.floor((Date.now()-since.getTime())/1000);
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60;
  const now = new Date();
  termLine(`  <span style="color:#a89984">${now.toLocaleTimeString()}  up ${h>0?h+'h ':''}${m}m ${s}s  ·  load: pomodoro ${pomoRunning?'active':'idle'}</span>`);
}, { desc:'Show session uptime' });

reg('date', () => {
  const n = new Date();
  termLine(`  <span style="color:#ebdbb2">${n.toDateString()}  ${n.toLocaleTimeString()}  UTC${n.getTimezoneOffset()<0?'+':''}${-n.getTimezoneOffset()/60}</span>`);
}, { desc:'Print current date and time' });

reg('whoami', () => {
  termLine(`  <span style="color:#fabd2f">focus</span>`);
}, { desc:'Print current user' });

// ── Tools ───────────────────────────────────────────────────
reg('cal', () => {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const days = new Date(y,mo+1,0).getDate();
  let firstDow = new Date(y,mo,1).getDay(); // 0=Sun
  // shift to Mon-start
  firstDow = (firstDow+6)%7;
  const tracked = new Set(timeEntries.filter(e=>sameMon(new Date(e.startTime),now)).map(e=>new Date(e.startTime).getDate()));
  const mName   = now.toLocaleDateString('en',{month:'long',year:'numeric'});
  termBlank();
  termLine(`<span style="color:#d3869b">  ${mName.toUpperCase()}</span>`,'tl-head');
  termLine(`<span style="color:#665c54">  Mo  Tu  We  Th  Fr  Sa  Su</span>`);
  let row='  ' + '    '.repeat(firstDow);
  for (let d=1; d<=days; d++) {
    const isToday = d===now.getDate();
    const hasTr   = tracked.has(d);
    const col     = isToday?'#fabd2f':hasTr?'#b8bb26':'#ebdbb2';
    const sym     = isToday?'◆':hasTr?'●':' ';
    row += `<span style="color:${col}">${String(d).padStart(2)}${sym} </span>`;
    const dow = (firstDow + d - 1) % 7;
    if (dow===6 || d===days) { termLine(row); row='  '; }
  }
  termBlank();
  termLine(`  <span style="color:#fabd2f">◆</span> today  <span style="color:#b8bb26">●</span> tracked`);
  termBlank();
}, { desc:'Show calendar for current month' });

reg('neofetch', () => {
  const now    = new Date();
  const upSec  = Math.floor((Date.now() - (window._appStart||now).getTime()) / 1000);
  const upStr  = upSec < 60 ? `${upSec}s`
               : upSec < 3600 ? `${Math.floor(upSec/60)}m ${upSec%60}s`
               : `${Math.floor(upSec/3600)}h ${Math.floor((upSec%3600)/60)}m`;
  const used   = lsUsed();
  const quota  = 5*1024*1024;
  const usedMB = (used/1048576).toFixed(2);
  const totMB  = (quota/1048576).toFixed(0);
  const ua     = navigator.userAgent;
  const cores  = navigator.hardwareConcurrency || '?';
  const mem    = navigator.deviceMemory ? `${navigator.deviceMemory} GiB` : 'unknown';
  const res    = `${screen.width}x${screen.height}`;
  const dpr    = window.devicePixelRatio||1;
  const lang   = navigator.language || 'en-US';
  const brw    = ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge'
               : ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : 'Browser';
  const brwVer = (ua.match(new RegExp(brw.replace('Browser','Chrome')+'\\/([\\d.]+)')) || [])[1] || '';
  const plat   = ua.includes('Win') ? 'Windows' : ua.includes('Mac') ? 'macOS'
               : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android'
               : (ua.includes('iPhone')||ua.includes('iPad')) ? 'iOS' : 'Unknown';
  const pkgs   = timeEntries.length + projects.length + goals.length;
  const swapUsed = Math.max(0, used - 512*1024);
  const gpuStr = (() => {
    try {
      const c=document.createElement('canvas'); const gl=c.getContext('webgl');
      const d=gl&&gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL).split('/')[0].trim() : 'unknown';
    } catch(e){ return 'unknown'; }
  })();

  const cv = k => `<span style="color:#fabd2f;font-weight:700">${k}</span>`;
  const vv = v => `<span style="color:#ebdbb2">${v}</span>`;

  const infoRows = [
    `<span style="color:#fabd2f;font-weight:700">focus</span><span style="color:#665c54">@</span><span style="color:#8ec07c;font-weight:700">local</span>`,
    `<span style="color:#504945">${'─'.repeat(30)}</span>`,
    `${cv('OS')}          ${vv(plat)}`,
    `${cv('Kernel')}      ${vv('focusos ' + (navigator.platform||plat).toLowerCase())}`,
    `${cv('Uptime')}      ${vv(upStr)}`,
    `${cv('Packages')}    ${vv(pkgs + ' (entries+proj+goals)')}`,
    `${cv('Shell')}       ${vv('focusbash 2.0')}`,
    `${cv('Resolution')}  ${vv(res + ' @ ' + dpr + 'x')}`,
    `${cv('DE')}          ${vv('Focus Workspace')}`,
    `${cv('WM')}          ${vv('Pomodoro Compositor')}`,
    `${cv('Terminal')}    ${vv(brw + (brwVer ? ' ' + brwVer.split('.')[0] : ''))}`,
    `${cv('CPU')}         ${vv(cores + '-core (logical)')}`,
    `${cv('GPU')}         ${vv(gpuStr)}`,
    `${cv('Memory')}      ${vv(mem)}`,
    `${cv('Swap')}        ${vv(fmtSz(swapUsed) + ' / ' + fmtSz(512*1024))}`,
    `${cv('Disk')}        ${vv(usedMB + 'M / ' + totMB + 'M')}`,
    `${cv('Battery')}     <span id="neofetchBat" style="color:#ebdbb2">checking…</span>`,
    `${cv('Locale')}      ${vv(lang)}`,
    ``,
    `<span style="background:#282828;color:#282828"> ▌</span><span style="background:#cc241d;color:#cc241d"> ▌</span><span style="background:#98971a;color:#98971a"> ▌</span><span style="background:#d79921;color:#d79921"> ▌</span><span style="background:#458588;color:#458588"> ▌</span><span style="background:#b16286;color:#b16286"> ▌</span><span style="background:#689d6a;color:#689d6a"> ▌</span><span style="background:#a89984;color:#a89984"> ▌</span>`,
    `<span style="background:#928374;color:#928374"> ▌</span><span style="background:#fb4934;color:#fb4934"> ▌</span><span style="background:#b8bb26;color:#b8bb26"> ▌</span><span style="background:#fabd2f;color:#fabd2f"> ▌</span><span style="background:#83a598;color:#83a598"> ▌</span><span style="background:#d3869b;color:#d3869b"> ▌</span><span style="background:#8ec07c;color:#8ec07c"> ▌</span><span style="background:#ebdbb2;color:#ebdbb2"> ▌</span>`,
  ];

  termBlank();

  // ── Logo (full-width, auto-scaled) then info below ──────────
  // Build logo element directly (no termOutput wrapper needed)
  const logoWrap = document.createElement('div');
  logoWrap.style.cssText = 'transform-origin:left top;white-space:pre;line-height:1.3;margin-bottom:4px;';
  ASCII_LOGO_ROWS.forEach(([text, color]) => {
    const ln = document.createElement('div');
    ln.style.cssText = `color:${color};font-family:'JetBrains Mono',monospace;font-size:12.5px;`;
    ln.textContent = text;
    logoWrap.appendChild(ln);
  });
  termOutput.appendChild(logoWrap);

  // Scale logo to fit
  requestAnimationFrame(() => {
    const avail  = termOutput.clientWidth - 8;
    const actual = logoWrap.scrollWidth;
    if (actual > avail && avail > 0) {
      const ratio = avail / actual;
      logoWrap.style.transform = `scale(${ratio})`;
      logoWrap.style.marginBottom = `${-(logoWrap.scrollHeight * (1 - ratio))}px`;
    }
  });

  // Info rows below logo
  termBlank();
  infoRows.forEach(row => termLine(`  ${row}`));
  termBlank();

  // async battery
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      const el = document.getElementById('neofetchBat');
      if (el) el.textContent = `${Math.round(b.level*100)}%${b.charging ? ' (charging)' : ''}`;
    }).catch(()=>{});
  }
}, { desc:'Display system info with FOCUSED logo' });

// ── Keyboard shortcuts reference ────────────────────────────
reg(['keys','shortcuts','binds','keybinds'], () => {
  const sec = (title, col) => termLine(`<span style="color:${col};font-weight:700">  ── ${title} ${'─'.repeat(Math.max(0,38-title.length))}</span>`,'tl-head');
  const row = (keys, desc) => {
    const k = keys.map(k=>`<span style="color:#fabd2f;font-weight:700">${k}</span>`).join(' <span style="color:#665c54">+</span> ');
    termLine(`    ${k.padEnd?k:k}  <span style="color:#a89984">${desc}</span>`);
  };
  termBlank();
  termLine(`<span style="color:#d3869b">  FOCUS KEYBOARD SHORTCUTS  ─────────────────────</span>`,'tl-head');
  termBlank();
  sec('POMODORO TIMER','#fb4934');
  row(['Space'],         'Start / Pause timer');
  row(['R'],             'Reset current session');
  row(['S'],             'Skip to next session');
  row(['1'],             'Switch → Work mode');
  row(['2'],             'Switch → Short break');
  row(['3'],             'Switch → Long break');
  termBlank();
  sec('TASK TRACKER','#b8bb26');
  row(['N'],             'Focus task input field');
  row(['Ctrl','Enter'],  'Start / Stop time tracking');
  row(['Ctrl','P'],      'Pause / Resume tracker');
  row(['['],             'Previous day');
  row([']'],             'Next day');
  row(['T'],             'Jump to today');
  termBlank();
  sec('TERMINAL DATA COMMANDS','#d3869b');
  row(['track <task>'],  'Start tracking from terminal');
  row(['stop'],          'Stop current tracking');
  row(['add <t> <dur>'], 'Add manual entry (e.g. add focus 1h30m)');
  row(['entries'],       'List today\'s entries');
  row(['total week'],    'Show weekly total');
  row(['habit done'],    'Mark a habit complete');
  row(['note <text>'],   'Save a timestamped note');
  termBlank();
  sec('NAVIGATION','#83a598');
  row(['G'],             'New goal');
  row(['P'],             'New project');
  row(['Ctrl','K'],      'Command palette');
  row(['Ctrl','H'],      'Focus heatmap');
  row(['Ctrl','L'],      'Day timeline');
  row(['Ctrl',','],      'Timer settings');
  termBlank();
  sec('PANELS & MODALS','#d3869b');
  row(['`'],             'Toggle terminal (this)');
  row(['?'],             'Show keyboard shortcuts panel');
  row(['Esc'],           'Close modal / overlay');
  row(['Ctrl','B'],      'Habits & routines');
  row(['Ctrl','H'],      'Focus heatmap');
  row(['Ctrl','L'],      'Day timeline');
  row(['Ctrl','R'],      'Advanced reports');
  row(['Ctrl','S'],      'Statistics & analytics');
  row(['Ctrl','E'],      'Export data');
  row(['Ctrl','I'],      'Import data');
  termBlank();
  sec('TERMINAL (IN-TERMINAL)','#8ec07c');
  row(['↑ / ↓'],         'Navigate command history');
  row(['Tab'],           'Autocomplete command');
  row(['Ctrl','L'],      'Clear terminal');
  row(['Ctrl','C'],      'Cancel current input');
  termBlank();
  termLine(`  <span style="color:#665c54">tip: open the full GUI panel with <span style="color:#8ec07c">?</span> outside the terminal</span>`);
  termBlank();
}, { desc:'Show all keyboard shortcuts and key bindings' });

// ── Data & Automation commands ────────────────────────────

// TRACK — start tracking a task directly from terminal
reg(['track','start'], ({ args }) => {
  if (taskRunning) {
    termLine(`  <span style="color:#fb4934">✗ Already tracking: <strong>${escHtml(activeEntry?.task||'')}</strong></span>`);
    termLine(`  <span style="color:#665c54">  use <span style="color:#fabd2f">stop</span> first</span>`);
    return;
  }
  const raw   = args.join(' ');
  // Syntax: track "task name" [#project]
  const projM = raw.match(/#(\S+)/);
  const task  = raw.replace(/#\S+/,'').trim();
  if (!task) { termLine(`  <span style="color:#fb4934">Usage: track &lt;task&gt; [#project]</span>`); return; }
  const proj  = projM ? projects.find(p => p.name.toLowerCase().includes(projM[1].toLowerCase())) : null;
  taskInput.value = task;
  projSelect.value = proj?.id || '';
  trackBtn.click();
  termLine(`  <span style="color:#b8bb26">▶ Tracking: <strong style="color:#ebdbb2">${escHtml(task)}</strong>${proj?' · '+escHtml(proj.name):''}</span>`);
}, { desc:'Start time tracking', usage:'track <task> [#project]' });

// STOP — stop current tracking
reg('stop', () => {
  if (!taskRunning) { termLine(`  <span style="color:#665c54">No active session.</span>`); return; }
  const task = activeEntry?.task || '';
  trackBtn.click();
  termLine(`  <span style="color:#fb4934">■ Stopped: <strong style="color:#ebdbb2">${escHtml(task)}</strong></span>`);
  const ms = timeEntries[timeEntries.length-1]?.durationMs || 0;
  if (ms) termLine(`  <span style="color:#665c54">  session: ${fmt(ms)}</span>`);
}, { desc:'Stop current time tracking' });

// PAUSE / RESUME
reg(['pause','resume'], () => {
  if (!taskRunning) { termLine(`  <span style="color:#665c54">No active session.</span>`); return; }
  pauseBtn.click();
  const state = taskPaused ? 'Paused' : 'Resumed';
  const col   = taskPaused ? '#fabd2f' : '#b8bb26';
  termLine(`  <span style="color:${col}">${state}: <strong style="color:#ebdbb2">${escHtml(activeEntry?.task||'')}</strong></span>`);
}, { desc:'Pause or resume current tracking' });

// STATUS — live session overview
reg(['status','st'], () => {
  termBlank();
  if (taskRunning) {
    const ms = activeEntry ? _committedMs(activeEntry) : 0;
    termLine(`  <span style="color:#b8bb26">▶ RUNNING</span>  <span style="color:#ebdbb2">${escHtml(activeEntry?.task||'')}</span>`);
    if (activeEntry?.projectName) termLine(`  <span style="color:#665c54">  project: ${escHtml(activeEntry.projectName)}</span>`);
    termLine(`  <span style="color:#665c54">  elapsed: <span style="color:#fabd2f">${fmt(ms)}</span></span>`);
  } else if (taskPaused) {
    termLine(`  <span style="color:#fabd2f">⏸ PAUSED</span>  ${escHtml(activeEntry?.task||'')}`);
  } else {
    termLine(`  <span style="color:#665c54">■ No active session</span>`);
  }
  // Today total
  const todayMs = timeEntries.filter(e => sameDay(new Date(e.startTime), new Date())).reduce((s,e)=>s+(e.durationMs||0),0);
  termLine(`  <span style="color:#665c54">  today total: <span style="color:#83a598">${fmt(todayMs)}</span></span>`);
  termBlank();
}, { desc:'Show current tracking status and today total' });

// ADD — add a manual time entry without the UI
reg('add', ({ args }) => {
  // Syntax: add <task> <duration> [#project]
  // Duration: 25m | 1h30m | 1.5h
  const raw  = args.join(' ');
  const durM = raw.match(/(\d+(?:\.\d+)?)(h|m)(?:(\d+)m)?/i);
  if (!durM) { termLine(`  <span style="color:#fb4934">Usage: add &lt;task&gt; &lt;duration&gt; [#project]</span>`); termLine(`  <span style="color:#665c54">  e.g. add deep work 1h30m #research</span>`); return; }
  let ms = 0;
  if (durM[2].toLowerCase() === 'h') {
    ms = (parseFloat(durM[1]) * 3600 + (parseInt(durM[3]||0) * 60)) * 1000;
  } else {
    ms = parseFloat(durM[1]) * 60000;
  }
  if (ms < 60000) { termLine(`  <span style="color:#fb4934">Duration too short (minimum 1m)</span>`); return; }
  const projM = raw.match(/#(\S+)/);
  const proj  = projM ? projects.find(p => p.name.toLowerCase().includes(projM[1].toLowerCase())) : null;
  const task  = raw.replace(/\d+(?:\.\d+)?(?:h|m)(?:\d+m)?/i,'').replace(/#\S+/,'').trim();
  if (!task) { termLine(`  <span style="color:#fb4934">Task name is required.</span>`); return; }
  const end   = new Date();
  const start = new Date(end - ms);
  const entry = { id:uid(), task, projectId:proj?.id||null, projectName:proj?.name||null, startTime:start.toISOString(), endTime:end.toISOString(), durationMs:ms, segments:[] };
  timeEntries.push(entry); save(); rerender();
  termLine(`  <span style="color:#b8bb26">+ Added: <strong style="color:#ebdbb2">${escHtml(task)}</strong> — ${fmt(ms)}${proj?' · '+escHtml(proj.name):''}</span>`);
  if(proj) updateGoalProgress(proj.id, ms);
}, { desc:'Add a manual entry', usage:'add <task> <duration> [#project]' });

// ENTRIES — show entries for a date
reg(['entries','ls','tasks'], ({ args }) => {
  const dateArg = args[0];
  let date = new Date();
  if (dateArg === 'yesterday') { date.setDate(date.getDate()-1); }
  else if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) { date = new Date(dateArg+'T12:00:00'); }
  const dayEs = timeEntries.filter(e=>sameDay(new Date(e.startTime),date)).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const label = sameDay(date,new Date()) ? 'Today' : date.toDateString();
  termBlank();
  termLine(`<span style="color:#d3869b">── ${label} · ${dayEs.length} entries ────────────────────</span>`,'tl-head');
  if (!dayEs.length) { termLine(`  <span style="color:#504945">no entries</span>`); termBlank(); return; }
  dayEs.forEach((e, i) => {
    const t   = new Date(e.startTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const col = projColor(e.projectId);
    const run = taskRunning && activeEntry?.id === e.id;
    termLine(`  <span style="color:#504945">${String(i+1).padStart(2)}</span>  <span style="color:#665c54">${t}</span>  <span style="color:${col}">●</span> <span style="color:#ebdbb2">${escHtml(e.task||'—')}</span>  <span style="color:#83a598">${run?'running…':fmt(e.durationMs||0)}</span>`);
  });
  const total = dayEs.reduce((s,e)=>s+(e.durationMs||0),0);
  termLine(`  <span style="color:#665c54">  ─────────────────────────── total: <span style="color:#fabd2f">${fmt(total)}</span></span>`);
  termBlank();
}, { desc:'List entries for today or a date', usage:'entries [yesterday|YYYY-MM-DD]' });

// TOTAL — quick time totals
reg(['total','sum'], ({ args }) => {
  const period = args[0] || 'today';
  const now = new Date();
  let entries, label;
  if (period === 'today') {
    entries = timeEntries.filter(e=>sameDay(new Date(e.startTime),now));
    label = 'Today';
  } else if (period === 'week') {
    const mon = new Date(now); mon.setDate(now.getDate()-now.getDay()+1); mon.setHours(0,0,0,0);
    entries = timeEntries.filter(e=>new Date(e.startTime)>=mon);
    label = 'This week';
  } else if (period === 'month') {
    const m1 = new Date(now.getFullYear(),now.getMonth(),1);
    entries = timeEntries.filter(e=>new Date(e.startTime)>=m1);
    label = 'This month';
  } else if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate()-1);
    entries = timeEntries.filter(e=>sameDay(new Date(e.startTime),y));
    label = 'Yesterday';
  } else {
    entries = timeEntries; label = 'All time';
  }
  const ms = entries.reduce((s,e)=>s+(e.durationMs||0),0);
  termBlank();
  termLine(`  <span style="color:#a89984">${label}:</span>  <span style="color:#fabd2f;font-size:inherit">${fmt(ms)}</span>  <span style="color:#665c54">(${entries.length} sessions)</span>`);
  // Per-project breakdown
  const byProj = {};
  entries.forEach(e=>{const k=e.projectName||'(no project)';byProj[k]=(byProj[k]||0)+(e.durationMs||0);});
  Object.entries(byProj).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([name,ms2])=>{
    termLine(`  <span style="color:#504945">  ${escHtml(name).padEnd?escHtml(name):'  '}</span>  <span style="color:#83a598">${fmt(ms2)}</span>`);
  });
  termBlank();
}, { desc:'Show tracked time totals', usage:'total [today|yesterday|week|month|all]' });

// HABIT DONE — mark a habit complete from terminal
reg(['hab','habit'], ({ args }) => {
  const sub  = args[0]?.toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);
  const key   = today.toISOString().slice(0,10);
  const activeH = habits.filter(h=>!h.archived && habIsScheduled(h, today));

  if (!sub || sub === 'list') {
    // List today's habits
    termBlank();
    termLine(`<span style="color:#b8bb26">── Habits · ${key} ───────────────────────────────</span>`,'tl-head');
    if (!activeH.length) { termLine(`  <span style="color:#504945">no habits scheduled today</span>`); termBlank(); return; }
    const c = habComp();
    activeH.forEach((h,i) => {
      const done = (c[key]||[]).includes(h.id);
      const streak = habStreak(h.id);
      termLine(`  ${done?'<span style="color:#b8bb26">✓</span>':'<span style="color:#504945">○</span>'} <span style="color:#ebdbb2">${escHtml((h.icon||'')+' '+h.name)}</span>  <span style="color:#665c54">streak: ${streak}d</span>`);
    });
    termLine(`  <span style="color:#665c54">  use <span style="color:#fabd2f">habit done &lt;name&gt;</span> to mark complete</span>`);
    termBlank();
    return;
  }

  if (sub === 'done' || sub === 'check' || sub === 'tick') {
    const nameQ = args.slice(1).join(' ').toLowerCase();
    if (!nameQ) { termLine(`  <span style="color:#fb4934">Usage: habit done &lt;name&gt;</span>`); return; }
    const match = activeH.find(h => h.name.toLowerCase().includes(nameQ));
    if (!match) { termLine(`  <span style="color:#fb4934">No habit matching "<strong>${escHtml(nameQ)}</strong>" scheduled today.</span>`); return; }
    const c = habComp();
    if ((c[key]||[]).includes(match.id)) {
      termLine(`  <span style="color:#665c54">Already done: <strong>${escHtml(match.name)}</strong></span>`);
      return;
    }
    c[key] = [...(c[key]||[]), match.id];
    localStorage.setItem('tt_hc', JSON.stringify(c));
    if (typeof renderHabitsModal === 'function' && $('habitsModal').classList.contains('open')) renderHabitsModal();
    const streak = habStreak(match.id);
    termLine(`  <span style="color:#b8bb26">✓ Done: <strong style="color:#ebdbb2">${escHtml((match.icon||'')+' '+match.name)}</strong>  🔥 ${streak} day streak</span>`);
    return;
  }

  termLine(`  <span style="color:#fb4934">Usage: habit [list|done &lt;name&gt;]</span>`);
}, { desc:'List or complete habits', usage:'habit [list | done <name>]' });

// GOAL — show goal progress
reg(['goal','goals'], ({ args }) => {
  termBlank();
  if (!goals.length) { termLine(`  <span style="color:#504945">No goals set.</span>`); termBlank(); return; }
  termLine(`<span style="color:#fabd2f">── Goals ──────────────────────────────────────</span>`,'tl-head');
  goals.forEach(g => {
    const p   = Math.min(100, Math.round((g.currentMs||0)/(g.targetMs||1)*100));
    const bar = '█'.repeat(Math.round(p/5)) + '░'.repeat(20-Math.round(p/5));
    const col = p>=100?'#b8bb26':p>=70?'#fabd2f':'#83a598';
    termLine(`  <span style="color:#ebdbb2">${escHtml(g.name)}</span>`);
    termLine(`  <span style="color:${col}">${bar}</span> <span style="color:${col}">${p}%</span>  <span style="color:#665c54">${fmt(g.currentMs||0)} / ${fmt(g.targetMs||0)}</span>`);
  });
  termBlank();
}, { desc:'Show goal progress' });

// PROJECT — list projects with time summary
reg(['project','proj','projects'], () => {
  termBlank();
  if (!projects.length) { termLine(`  <span style="color:#504945">No projects.</span>`); termBlank(); return; }
  termLine(`<span style="color:#d3869b">── Projects ──────────────────────────────────</span>`,'tl-head');
  const now = new Date();
  projects.forEach((p, i) => {
    const col  = PROJ_COLORS[i % PROJ_COLORS.length];
    const ms   = timeEntries.filter(e=>e.projectId===p.id).reduce((s,e)=>s+(e.durationMs||0),0);
    const last = timeEntries.filter(e=>e.projectId===p.id).sort((a,b)=>new Date(b.startTime)-new Date(a.startTime))[0];
    const daysAgo = last ? Math.floor((now-new Date(last.startTime))/86400000) : null;
    const ago  = daysAgo===0?'today':daysAgo===1?'yesterday':daysAgo!=null?`${daysAgo}d ago`:'—';
    termLine(`  <span style="color:${col}">●</span> <span style="color:#ebdbb2">${escHtml(p.name)}</span>  <span style="color:#83a598">${fmt(ms)}</span>  <span style="color:#504945">last: ${ago}</span>`);
  });
  termBlank();
}, { desc:'List projects with time summary' });

// DELETE — delete a time entry by index shown in `entries`
reg(['delete','del','rm'], ({ args }) => {
  if (!args[0]) { termLine(`  <span style="color:#fb4934">Usage: delete &lt;entry-id&gt;</span>`); return; }
  const today = timeEntries.filter(e=>sameDay(new Date(e.startTime),new Date())).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const idx   = parseInt(args[0]) - 1;
  if (isNaN(idx) || idx < 0 || idx >= today.length) { termLine(`  <span style="color:#fb4934">Index out of range. Run <span style="color:#fabd2f">entries</span> to see valid indices.</span>`); return; }
  const entry = today[idx];
  if (taskRunning && activeEntry?.id === entry.id) { termLine(`  <span style="color:#fb4934">Cannot delete a running entry. Stop it first.</span>`); return; }
  if (!confirm(`Delete "${entry.task}" (${fmt(entry.durationMs)})?`)) return;
  const gi = timeEntries.findIndex(e=>e.id===entry.id);
  if (gi !== -1) timeEntries.splice(gi, 1);
  save(); rerender();
  termLine(`  <span style="color:#fb4934">✗ Deleted: <strong>${escHtml(entry.task)}</strong> (${fmt(entry.durationMs)})</span>`);
}, { desc:'Delete a today entry by index', usage:'delete <index> (from entries list)' });

// NOTE — open a quick text prompt and add a timestamped note entry
reg('note', ({ args }) => {
  const text = args.join(' ').trim() || prompt('Enter note:');
  if (!text) return;
  const entry = { id:uid(), task:`📝 ${text}`, projectId:null, projectName:null, startTime:new Date().toISOString(), endTime:new Date().toISOString(), durationMs:0, segments:[], isNote:true };
  timeEntries.push(entry); save(); rerender();
  termLine(`  <span style="color:#83a598">📝 Note saved: <em style="color:#a89984">${escHtml(text)}</em></span>`);
}, { desc:'Save a timestamped note', usage:'note <text>' });

// OPEN — explicitly open any panel (consolidated launcher)
const _openPanel = (name) => {
  const map = {
    stats:    'openStatsBtn',    reports: 'openReportBtn',
    heatmap:  'openHeatmapBtn',  habits:  'openHabitsBtn',
    timeline: 'openTimelineBtn', import:  'openImportBtn',
    export:   'openExportBtn',
  };
  const btn = map[name];
  if (!btn) { termLine(`  <span style="color:#fb4934">Unknown panel. Try: ${Object.keys(map).join(', ')}</span>`); return; }
  termLine(`  <span style="color:#8ec07c">→ opening ${name}…</span>`);
  termBlank();
  setTimeout(() => document.getElementById(btn)?.click(), 180);
};
reg('open', ({ args }) => { _openPanel(args[0]?.toLowerCase() || ''); },
  { desc:'Open a UI panel', usage:'open <stats|reports|heatmap|habits|timeline|import|export>' });

// Keep individual aliases but route through _openPanel so they benefit from behind-fix
reg('stats',    () => _openPanel('stats'),    { desc:'Open statistics panel' });
reg('reports',  () => _openPanel('reports'),  { desc:'Open advanced reports panel' });
reg('heatmap',  () => _openPanel('heatmap'),  { desc:'Open focus heatmap' });
reg(['habits','hab','routines'], () => _openPanel('habits'), { desc:'Open habits & routines' });
reg(['timeline','tl'],           () => _openPanel('timeline'),{ desc:'Open day timeline' });
reg(['import'],                  () => _openPanel('import'), { desc:'Open import panel' });
reg(['export'],                  () => _openPanel('export'), { desc:'Open export panel' });

reg('history', () => {
  if (!termHistory.length) { termLine(`  <span style="color:#665c54">no history</span>`); return; }
  termBlank();
  termLine(`<span style="color:#d3869b">── command history ────────────────────────</span>`,'tl-head');
  [...termHistory].reverse().forEach((c,i) => {
    termLine(`  <span style="color:#665c54">${String(i+1).padStart(4)}</span>  <span style="color:#ebdbb2">${escHtml(c)}</span>`);
  });
  termBlank();
}, { desc:'Show command history' });

reg('echo', ({ args }) => {
  termLine(`  ${escHtml(args.join(' '))}`,'tl-sub');
}, { desc:'Print text to terminal', usage:'echo <text>' });

reg('man', ({ args }) => {
  const cmd = args[0];
  if (!cmd) { termLine(`  usage: man &lt;command&gt;`,'tl-err'); return; }
  if (!TERM_CMDS[cmd]) { termLine(`  <span style="color:#fb4934">no manual entry for '${escHtml(cmd)}'</span>  (try 'help')`,'tl-err'); return; }
  const c = TERM_CMDS[cmd];
  termBlank();
  termLine(`<span style="color:#d3869b">MAN(1)  FOCUS TERMINAL  MAN(1)</span>`,'tl-head');
  termBlank();
  termLine(`<span style="color:#fabd2f">NAME</span>`);
  termLine(`       ${cmd} — ${c.desc||'no description'}`);
  if (c.usage) { termBlank(); termLine(`<span style="color:#fabd2f">SYNOPSIS</span>`); termLine(`       ${c.usage}`); }
  termBlank();
}, { desc:'Show manual page for a command', usage:'man <command>' });

// ── Shell builtins ──────────────────────────────────────────
reg(['clear','cls'], () => { termOutput.innerHTML=''; termBoot(); }, { desc:'Clear terminal' });
reg(['exit','quit','q'], () => { termCloseFn(); }, { desc:'Close terminal' });
reg('version', () => {
  termLine(`  <span style="color:#fabd2f">FOCUS</span> <span style="color:#b8bb26">v2.0</span>  pomodoro + time tracker`);
  termLine(`  <span style="color:#665c54">focusbash 2.0  ·  gruvbox dark  ·  JetBrains Mono</span>`);
}, { desc:'Show version info' });

// ── Execute ─────────────────────────────────────────────────
const termExec = raw => {
  const trimmed = raw.trim();
  if (!trimmed) return;
  termHistory.unshift(trimmed);
  termHistIdx = -1;
  if (termHistory.length > 200) termHistory.pop();

  termPs1Echo(trimmed);

  const parts = trimmed.split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1);

  if (TERM_CMDS[cmd]) {
    TERM_CMDS[cmd].fn({ args, raw: trimmed });
  } else {
    termLine(`  <span style="color:#fb4934">focusbash: command not found: ${escHtml(cmd)}</span>  <span style="color:#665c54">— try <span style="color:#8ec07c">help</span></span>`,'tl-err');
  }
};

// ── Input handling ──────────────────────────────────────────
termInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = termInputEl.value;
    termInputEl.value = '';
    termExec(v);
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (termHistIdx < termHistory.length-1) { termHistIdx++; termInputEl.value = termHistory[termHistIdx]; }
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (termHistIdx > 0) { termHistIdx--; termInputEl.value = termHistory[termHistIdx]; }
    else if (termHistIdx === 0) { termHistIdx = -1; termInputEl.value = ''; }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const partial = termInputEl.value.toLowerCase().split(' ')[0];
    const isFirst = !termInputEl.value.includes(' ');
    if (isFirst) {
      const matches = [...new Set(Object.keys(TERM_CMDS))].filter(c=>c.startsWith(partial));
      if (matches.length === 1) termInputEl.value = matches[0];
      else if (matches.length > 1) termLine(`  <span style="color:#a89984">${matches.sort().join('  ')}</span>`);
    }
  }
  if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); termOutput.innerHTML=''; termBoot(); }
  if (e.key === 'c' && e.ctrlKey) { termInputEl.value=''; }
});

// ============================================================
// === EXPANDED KEYBOARD SHORTCUTS ============================
// ============================================================
document.addEventListener('keydown', e => {
  const tag      = document.activeElement.tagName;
  const inInput  = tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT';
  const modalOpen= !!document.querySelector('.overlay.open:not(#terminalModal)');
  const termIsOpen = termModal.classList.contains('open');

  // `` ` `` toggles terminal — never blocked
  if (e.key==='`' && !inInput) { e.preventDefault(); termIsOpen ? termCloseFn() : termOpenFn(); return; }

  // ? opens shortcuts help
  if (e.key==='?' && !inInput && !modalOpen && !termIsOpen) { e.preventDefault(); openM('kbModal'); return; }

  // All other shortcuts blocked when in input / modal / terminal
  if (inInput || modalOpen || termIsOpen) return;

  // Pomodoro
  if (e.code==='Space')                      { e.preventDefault(); $('pomoStart').click(); }
  if (e.code==='KeyR' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('pomoReset').click(); }
  if (e.code==='KeyS' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('pomoSkip').click();  }
  if (e.code==='Digit1')                     { e.preventDefault(); document.querySelector('.pomo-tab[data-m="work"]').click();  }
  if (e.code==='Digit2')                     { e.preventDefault(); document.querySelector('.pomo-tab[data-m="short"]').click(); }
  if (e.code==='Digit3')                     { e.preventDefault(); document.querySelector('.pomo-tab[data-m="long"]').click();  }

  // Tracker
  if (e.code==='KeyN' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); taskInput.focus(); }
  if (e.code==='Enter' && e.ctrlKey)          { e.preventDefault(); trackBtn.click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='p' && !e.shiftKey) {
    if (taskRunning) { e.preventDefault(); pauseBtn.click(); }
  }

  // Date navigation
  if (e.code==='BracketLeft')  { e.preventDefault(); $('prevDateBtn').click(); }
  if (e.code==='BracketRight') { e.preventDefault(); $('nextDateBtn').click(); }
  if (e.code==='KeyT' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('goTodayBtn').click(); }

  // Create
  if (e.code==='KeyG' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('openGoalBtn').click(); }
  if (e.code==='KeyP' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('openProjBtn').click(); }

  // Ctrl combos
  if ((e.ctrlKey||e.metaKey) && e.key==='h') { e.preventDefault(); $('openHeatmapBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='b') { e.preventDefault(); $('openHabitsBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='l') { e.preventDefault(); $('openTimelineBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key===',') { e.preventDefault(); $('pomoSettingsBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='e') { e.preventDefault(); $('openExportBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='i') { e.preventDefault(); $('openImportBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='r') { e.preventDefault(); $('openReportBtn').click(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); $('openStatsBtn').click(); }
});

window._appStart = new Date();

// ============================================================
// === WEATHER ENGINE =========================================
// ============================================================
(function initWeather() {

  const WX_KEY   = 'tt_wx_hist';
  const WX_COORD = 'tt_wx_coord';
  const WX_LAST  = 'tt_wx_last';
  const WX_12H   = 12 * 3600 * 1000;

  // WMO weather interpretation codes
  const WMO = {
    0:{l:'Clear sky',     e:'☀️', cat:'clear'},
    1:{l:'Mainly clear',  e:'🌤️',cat:'clear'},
    2:{l:'Partly cloudy', e:'⛅', cat:'cloudy'},
    3:{l:'Overcast',      e:'☁️', cat:'cloudy'},
    45:{l:'Fog',          e:'🌫️',cat:'cloudy'},
    48:{l:'Icy fog',      e:'🌫️',cat:'cloudy'},
    51:{l:'Light drizzle',e:'🌦️',cat:'rain'},
    53:{l:'Drizzle',      e:'🌦️',cat:'rain'},
    55:{l:'Heavy drizzle',e:'🌧️',cat:'rain'},
    61:{l:'Light rain',   e:'🌧️',cat:'rain'},
    63:{l:'Rain',         e:'🌧️',cat:'rain'},
    65:{l:'Heavy rain',   e:'🌧️',cat:'rain'},
    71:{l:'Light snow',   e:'🌨️',cat:'snow'},
    73:{l:'Snow',         e:'❄️', cat:'snow'},
    75:{l:'Heavy snow',   e:'❄️', cat:'snow'},
    80:{l:'Rain showers', e:'🌦️',cat:'rain'},
    81:{l:'Rain showers', e:'🌧️',cat:'rain'},
    82:{l:'Heavy showers',e:'⛈️',cat:'storm'},
    95:{l:'Thunderstorm', e:'⛈️',cat:'storm'},
  };

  // Find nearest WMO entry for a given code
  window.wxInfo = code => {
    if (WMO[code]) return WMO[code];
    const best = Math.max(...Object.keys(WMO).map(Number).filter(k => k <= code));
    return WMO[best] || {l:'Unknown', e:'🌡️', cat:'unknown'};
  };

  window.wxLoad = () => JSON.parse(localStorage.getItem(WX_KEY) || '[]');

  const wxSave = hist => localStorage.setItem(WX_KEY, JSON.stringify(hist.slice(-200)));

  // ── Fetch from Open-Meteo (no API key required) ───────────
  window.wxFetch = async () => {
    try {
      let coord = JSON.parse(localStorage.getItem(WX_COORD) || 'null');
      if (!coord) {
        coord = await new Promise((res, rej) => {
          if (!navigator.geolocation) { rej(new Error('Geolocation not available')); return; }
          navigator.geolocation.getCurrentPosition(
            p => res({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
            err => rej(err),
            { timeout: 10000, maximumAge: 86400000 }
          );
        });
        localStorage.setItem(WX_COORD, JSON.stringify(coord));
      }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
        `&timezone=auto&forecast_days=1`;

      const r = await fetch(url);
      if (!r.ok) throw new Error(`API ${r.status}`);
      const d = await r.json();
      const cu = d.current;

      const snap = {
        ts:      new Date().toISOString(),
        date:    new Date().toISOString().slice(0, 10),
        hour:    new Date().getHours(),
        temp:    Math.round(cu.temperature_2m   * 10) / 10,
        feels:   Math.round(cu.apparent_temperature * 10) / 10,
        humid:   cu.relative_humidity_2m,
        precip:  cu.precipitation,
        code:    cu.weather_code,
        wind:    Math.round(cu.wind_speed_10m),
        isDay:   cu.is_day === 1,
        lat:     coord.lat,
        lon:     coord.lon,
        tempMax: d.daily?.temperature_2m_max?.[0] ?? null,
        tempMin: d.daily?.temperature_2m_min?.[0] ?? null,
      };

      const hist = wxLoad();
      // Avoid duplicate within 1 hour
      const lastSnap = hist[hist.length - 1];
      if (!lastSnap || Math.abs(new Date(snap.ts) - new Date(lastSnap.ts)) > 3600000) {
        hist.push(snap);
        wxSave(hist);
      }
      localStorage.setItem(WX_LAST, Date.now().toString());
      toast(`🌤 Weather updated: ${snap.temp}°C ${wxInfo(snap.code).l}`, 'ok');
      return snap;
    } catch (err) {
      console.warn('Weather fetch failed:', err.message);
      return null;
    }
  };

  // ── Auto-fetch every 12 h ─────────────────────────────────
  const maybeAutoFetch = () => {
    const last = parseInt(localStorage.getItem(WX_LAST) || '0');
    if (Date.now() - last > WX_12H) wxFetch();
  };

  maybeAutoFetch();
  setInterval(maybeAutoFetch, 3600 * 1000); // check every hour

  // ── "weather" terminal command ────────────────────────────
  if (typeof reg === 'function') {
    reg(['weather','wx'], () => {
      const hist = wxLoad();
      const last = hist[hist.length - 1];
      if (!last) {
        termLine(`  <span style="color:#fb4934">No weather data yet.</span> Open Statistics and click <span style="color:#fabd2f">ENABLE WEATHER</span>.`);
        return;
      }
      const info = wxInfo(last.code);
      termBlank();
      termLine(`  <span style="color:#fabd2f">${info.e}  ${info.l}</span>`);
      termLine(`  <span style="color:#a89984">Temperature</span>  <span style="color:#ebdbb2">${last.temp}°C</span>  <span style="color:#665c54">(feels ${last.feels}°C)</span>`);
      termLine(`  <span style="color:#a89984">Humidity   </span>  <span style="color:#ebdbb2">${last.humid}%</span>`);
      termLine(`  <span style="color:#a89984">Wind       </span>  <span style="color:#ebdbb2">${last.wind} km/h</span>`);
      termLine(`  <span style="color:#a89984">Precip     </span>  <span style="color:#ebdbb2">${last.precip} mm</span>`);
      termLine(`  <span style="color:#665c54">Updated ${new Date(last.ts).toLocaleTimeString()}  ·  ${hist.length} snapshots stored</span>`);
      termBlank();
    }, { desc: 'Show current weather conditions' });
  }

  // ── Enable button (shown in stats modal) ──────────────────
  document.addEventListener('click', e => {
    if (!e.target.closest('#enableWeatherBtn')) return;
    $('enableWeatherBtn').textContent = 'Fetching…';
    $('enableWeatherBtn').disabled = true;
    wxFetch().then(snap => {
      if (snap) {
        $('statsWxPrompt').style.display = 'none';
        $('statsWxWrap').style.display   = 'block';
        // Re-render weather section
        if (window._buildWeatherSection) window._buildWeatherSection();
      } else {
        $('enableWeatherBtn').textContent = 'ENABLE WEATHER';
        $('enableWeatherBtn').disabled = false;
        toast('⚠ Could not get location. Check browser permissions.', 'err');
      }
    });
  });

  // ── Manual refresh with 30-min cooldown ───────────────────
  const WX_MANUAL_KEY = 'tt_wx_manual_last';
  const WX_COOLDOWN   = 30 * 60 * 1000; // 30 minutes
  let wxCooldownTimer = null;

  const wxCooldownRemaining = () => {
    const last = parseInt(localStorage.getItem(WX_MANUAL_KEY) || '0');
    return Math.max(0, WX_COOLDOWN - (Date.now() - last));
  };

  const wxFormatCountdown = ms => {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const wxUpdateCooldownUI = () => {
    const btn      = $('wxRefreshBtn');
    const fill     = $('wxCooldownFill');
    const label    = $('wxCooldownLabel');
    const wrapEl   = $('wxCooldownWrap');
    const iconEl   = $('wxRefreshIcon');
    const lblEl    = $('wxRefreshLabel');
    if (!btn) return;

    const remaining = wxCooldownRemaining();

    if (remaining > 0) {
      btn.disabled = true;
      btn.classList.add('cooling');
      if (wrapEl) wrapEl.style.display = 'flex';
      if (fill)  fill.style.width = `${((WX_COOLDOWN - remaining) / WX_COOLDOWN) * 100}%`;
      if (label) label.textContent = `next refresh in ${wxFormatCountdown(remaining)}`;
      if (lblEl) lblEl.textContent = wxFormatCountdown(remaining);
      if (iconEl) iconEl.className = 'fas fa-hourglass-half';
    } else {
      btn.disabled = false;
      btn.classList.remove('cooling');
      if (wrapEl) wrapEl.style.display = 'none';
      if (lblEl) lblEl.textContent = 'REFRESH';
      if (iconEl) iconEl.className = 'fas fa-rotate-right';
    }
  };

  const wxStartCooldownTick = () => {
    if (wxCooldownTimer) clearInterval(wxCooldownTimer);
    wxUpdateCooldownUI();
    if (wxCooldownRemaining() > 0) {
      wxCooldownTimer = setInterval(() => {
        const rem = wxCooldownRemaining();
        wxUpdateCooldownUI();
        if (rem <= 0) { clearInterval(wxCooldownTimer); wxCooldownTimer = null; }
      }, 1000);
    }
  };

  document.addEventListener('click', async e => {
    if (!e.target.closest('#wxRefreshBtn')) return;
    if (wxCooldownRemaining() > 0) return; // should not happen since btn is disabled

    const btn   = $('wxRefreshBtn');
    const iconEl = $('wxRefreshIcon');
    const lblEl  = $('wxRefreshLabel');
    btn.disabled = true;
    if (iconEl) iconEl.className = 'fas fa-rotate-right wx-spin';
    if (lblEl)  lblEl.textContent = 'Fetching…';

    const snap = await wxFetch();

    if (snap) {
      localStorage.setItem(WX_MANUAL_KEY, Date.now().toString());
      wxStartCooldownTick();
      if (window._buildWeatherSection) window._buildWeatherSection();
      toast(`🌤 Weather refreshed: ${snap.temp}°C ${wxInfo(snap.code).l}`);
    } else {
      btn.disabled = false;
      if (iconEl) iconEl.className = 'fas fa-rotate-right';
      if (lblEl)  lblEl.textContent = 'REFRESH';
      toast('⚠ Refresh failed — check location permissions.', 'err');
    }
  });

  // Restore cooldown state when stats modal opens (user may have refreshed earlier)
  document.addEventListener('click', e => {
    if (!e.target.closest('#openStatsBtn') && !e.target.closest('#statsPdfBtn')) return;
    // Small delay so DOM is ready
    setTimeout(wxStartCooldownTick, 300);
  });

})();



(function initStats() {

  let statsRange = 7; // days

  // ── Helpers ──────────────────────────────────────────────
  const msToHrs = ms => ms / 3600000;
  const msToPretty = ms => {
    const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const getEntries = range => {
    if (range === 'all') return timeEntries;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - range); cutoff.setHours(0,0,0,0);
    return timeEntries.filter(e => new Date(e.startTime) >= cutoff);
  };

  // ── Statistical functions ─────────────────────────────────
  const statMean   = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
  const statMedian = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a,b)=>a-b);
    const m = Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
  };
  const statStdDev = arr => {
    if (arr.length < 2) return 0;
    const mean = statMean(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-mean)**2,0)/(arr.length-1));
  };
  const statMax = arr => arr.length ? Math.max(...arr) : 0;
  const statMin = arr => arr.length ? Math.min(...arr) : 0;
  const statSum = arr => arr.reduce((s,v)=>s+v,0);
  // Pearson correlation coefficient
  const pearson = (xs, ys) => {
    if (xs.length < 2) return 0;
    const mx = statMean(xs), my = statMean(ys);
    const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
    const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
    return den === 0 ? 0 : num/den;
  };
  // linear regression: returns {slope, intercept}
  const linReg = (xs, ys) => {
    const mx = statMean(xs), my = statMean(ys);
    const slope = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0) / (xs.reduce((s,x)=>s+(x-mx)**2,0)||1);
    return { slope, intercept: my - slope*mx };
  };

  // ── Canvas chart helpers ──────────────────────────────────
  const COLORS = ['#83a598','#fabd2f','#b8bb26','#d3869b','#8ec07c','#fe8019','#fb4934','#458588'];
  const gruvDim = '#504945';

  const clearCanvas = cvs => {
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    return ctx;
  };

  // Robust canvas-width reader — uses getBoundingClientRect so it works
  // even when the modal is animating in or the parent is a CSS grid cell.
  const cvsW = (cvs, pad = 28) => {
    const rect = cvs.parentElement?.getBoundingClientRect();
    const w = rect ? Math.floor(rect.width) - pad : 0;
    return w > 10 ? w : 0;
  };

  // Draw a responsive bar chart
  const drawBarChart = (cvs, labels, values, color, options = {}) => {
    const W = cvsW(cvs); if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    const H = options.h || 140;
    cvs.width  = W * dpr; cvs.height = H * dpr;
    cvs.style.width  = W + 'px'; cvs.style.height = H + 'px';
    const ctx = clearCanvas(cvs); ctx.scale(dpr, dpr);

    const pad = { top:8, right:8, bottom:28, left:46 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;
    const maxV = Math.max(...values, 0.001);

    // Trend line data
    const trendXs = values.map((_,i)=>i);
    const { slope, intercept } = linReg(trendXs, values);

    // Y axis lines
    const steps = 4;
    ctx.font = `9px JetBrains Mono, monospace`; ctx.textAlign = 'right';
    for (let i = 0; i <= steps; i++) {
      const v = maxV * (i/steps);
      const y = pad.top + cH - (cH * i/steps);
      ctx.strokeStyle = gruvDim + '44'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#665c54'; ctx.fillText(msToPretty(v*3600000), pad.left - 4, y + 3);
    }

    // Bars
    const barW = Math.max(2, cW/values.length - 3);
    values.forEach((v, i) => {
      const x = pad.left + (cW/values.length)*i + (cW/values.length - barW)/2;
      const bH = cH * (v/maxV);
      const y = pad.top + cH - bH;
      const isLast = i === values.length - 1;
      ctx.fillStyle = isLast ? (options.highlightLast || color + 'cc') : color + '99';
      ctx.beginPath();
      const r = Math.min(3, barW/2);
      ctx.moveTo(x+r, y); ctx.lineTo(x+barW-r, y);
      ctx.quadraticCurveTo(x+barW, y, x+barW, y+r);
      ctx.lineTo(x+barW, y+bH); ctx.lineTo(x, y+bH);
      ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.fill();
      // X label
      if (labels[i]) {
        ctx.fillStyle = '#504945'; ctx.textAlign = 'center'; ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillText(labels[i], x + barW/2, H - pad.bottom + 12);
      }
    });

    // Trend line
    if (values.length > 2 && options.trend !== false) {
      ctx.strokeStyle = '#fabd2f88'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath();
      trendXs.forEach((xi, i) => {
        const x = pad.left + (cW/values.length)*xi + (cW/values.length)/2;
        const y = pad.top + cH - cH * Math.max(0,Math.min(intercept + slope*xi, maxV)) / maxV;
        i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      });
      ctx.stroke(); ctx.setLineDash([]);
    }
  };

  // Draw a horizontal bar chart (for projects/dow)
  const drawHBarChart = (cvs, labels, values, colors, h) => {
    const dpr = window.devicePixelRatio || 1;
    const W = cvsW(cvs); if (!W) return;
    const H = h || Math.max(100, labels.length * 28 + 20);
    cvs.width  = W * dpr; cvs.height = H * dpr;
    cvs.style.width  = W + 'px'; cvs.style.height = H + 'px';
    const ctx = clearCanvas(cvs); ctx.scale(dpr, dpr);

    const maxV = Math.max(...values, 0.001);
    const labW = 60, pad = 12;
    const barZone = W - labW - pad - 50;

    labels.forEach((lbl, i) => {
      const y = 10 + i * 26;
      const bW = barZone * values[i] / maxV;
      const col = Array.isArray(colors) ? colors[i % colors.length] : colors;
      ctx.fillStyle = col + '88';
      ctx.beginPath();
      const r = Math.min(4, 12/2);
      ctx.moveTo(labW, y+r); ctx.lineTo(labW+bW-r, y);
      ctx.quadraticCurveTo(labW+bW, y, labW+bW, y+r);
      ctx.lineTo(labW+bW, y+12); ctx.lineTo(labW, y+12);
      ctx.lineTo(labW, y+r); ctx.fill();
      ctx.fillStyle = '#a89984'; ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right'; ctx.fillText(lbl, labW - 4, y + 10);
      ctx.fillStyle = '#ebdbb2'; ctx.textAlign = 'left';
      ctx.fillText(msToPretty(values[i]*3600000), labW + bW + 4, y + 10);
    });
  };

  // Draw donut chart
  const drawDonut = (cvs, labels, values, colors, h) => {
    const dpr = window.devicePixelRatio || 1;
    const W = cvsW(cvs); if (!W) return;
    const H = h || 180;
    cvs.width  = W * dpr; cvs.height = H * dpr;
    cvs.style.width  = W + 'px'; cvs.style.height = H + 'px';
    const ctx = clearCanvas(cvs); ctx.scale(dpr, dpr);
    if (!values.length || statSum(values) === 0) {
      ctx.fillStyle = '#504945'; ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center'; ctx.fillText('no data', W/2, H/2); return;
    }
    const cx = W * 0.35, cy = H/2, r = Math.min(cx, cy) - 16, inner = r * 0.55;
    const total = statSum(values);
    let angle = -Math.PI/2;
    values.forEach((v, i) => {
      const sweep = (v/total) * 2 * Math.PI;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle+sweep); ctx.closePath();
      ctx.fillStyle = colors[i % colors.length]; ctx.fill();
      angle += sweep;
    });
    // inner hole
    ctx.beginPath(); ctx.arc(cx, cy, inner, 0, 2*Math.PI);
    ctx.fillStyle = '#282828'; ctx.fill();
    // center text
    ctx.fillStyle = '#ebdbb2'; ctx.font = 'bold 13px JetBrains Mono, monospace';
    ctx.textAlign = 'center'; ctx.fillText(msToPretty(total*3600000), cx, cy+5);
    // legend
    const lx = W * 0.68, ly0 = (H - labels.length*18)/2;
    labels.forEach((lbl, i) => {
      const y = ly0 + i*18;
      ctx.fillStyle = colors[i%colors.length]; ctx.fillRect(lx, y+2, 10, 10);
      ctx.fillStyle = '#a89984'; ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.fillText(lbl.slice(0,16), lx+14, y+11);
      ctx.fillStyle = '#ebdbb2';
      ctx.fillText(msToPretty(values[i]*3600000), lx+14+96, y+11);
    });
  };

  // ── Build / refresh stats ─────────────────────────────────
  const buildStats = () => {
    const entries = getEntries(statsRange);
    const now = new Date();

    // ── KPI cards ──────────────────────────────────────────
    const totalMs = statSum(entries.map(e=>e.durationMs||0));
    const trackedDays = new Set(entries.map(e=>new Date(e.startTime).toDateString())).size;
    const allDays = statsRange === 'all' ? trackedDays : statsRange;
    const avgDayMs = allDays ? totalMs / allDays : 0;

    // longest streak
    const daySet = new Set(timeEntries.map(e=>new Date(e.startTime).toDateString()));
    let streak = 0, maxStreak = 0, d2 = new Date();
    for (let i = 0; i < 365; i++) {
      if (daySet.has(d2.toDateString())) { streak++; maxStreak = Math.max(maxStreak,streak); }
      else streak = 0;
      d2.setDate(d2.getDate()-1);
    }
    // current streak (from today backward)
    let curStreak = 0, cs = new Date();
    while (daySet.has(cs.toDateString())) { curStreak++; cs.setDate(cs.getDate()-1); }

    const pomoToday   = pomoLog.filter(s=>s.mode==='work').length;
    const pomoTotal   = timeEntries.reduce((s,e)=>s+(e.pomoCount||0),0) || pomoToday;

    const kpis = [
      { val: totalMs ? msToPretty(totalMs) : '—',  lbl:'TOTAL TIME',     color:'#fabd2f', sub:`${trackedDays} tracked day${trackedDays!==1?'s':''}` },
      { val: avgDayMs ? msToPretty(avgDayMs) : '—',lbl:'DAILY AVERAGE',  color:'#83a598', sub:`over ${allDays} day${allDays!==1?'s':''}` },
      { val: String(entries.length),               lbl:'ENTRIES',        color:'#b8bb26', sub:'time blocks' },
      { val: curStreak > 0 ? curStreak+'d' : '0d', lbl:'CURRENT STREAK', color:'#8ec07c', sub:`best: ${maxStreak}d` },
      { val: String(projects.length),              lbl:'PROJECTS',       color:'#d3869b', sub:'total' },
      { val: String(pomoToday),                    lbl:'POMODOROS TODAY', color:'#fb4934', sub:'work sessions' },
    ];
    const kpiRow = $('statsKpiRow'); kpiRow.innerHTML = '';
    kpis.forEach(k => {
      const el = document.createElement('div'); el.className = 'stats-kpi-card';
      el.innerHTML = `<div class="stats-kpi-val" style="color:${k.color}">${k.val}</div><div class="stats-kpi-lbl">${k.lbl}</div><div class="stats-kpi-sub">${k.sub}</div>`;
      kpiRow.appendChild(el);
    });

    // ── Daily bar chart (last N days) ──────────────────────
    let dayCount;
    if (statsRange === 'all') {
      if (entries.length > 0) {
        const oldest = new Date(Math.min(...entries.map(e=>new Date(e.startTime))));
        const spanDays = Math.ceil((new Date()-oldest)/86400000) + 1;
        dayCount = Math.min(60, Math.max(14, spanDays));
      } else { dayCount = 14; }
    } else { dayCount = statsRange; }
    const dayLabels = [], dayVals = [];
    for (let i = dayCount-1; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate()-i); dt.setHours(0,0,0,0);
      const dayMs = entries.filter(e=>sameDay(new Date(e.startTime),dt)).reduce((s,e)=>s+(e.durationMs||0),0);
      dayLabels.push(i===0?'today':dt.getDate()===1?dt.toLocaleDateString('en',{month:'short'}):String(dt.getDate()));
      dayVals.push(msToHrs(dayMs));
    }
    const dCvs = $('statsDailyChart');
    requestAnimationFrame(() => drawBarChart(dCvs, dayLabels, dayVals, '#83a598', { h:140, highlightLast:'#8ec07c' }));

    // ── Project donut ──────────────────────────────────────
    const projData = projects.map((p,i) => ({
      name: p.name,
      ms: entries.filter(e=>e.projectId===p.id).reduce((s,e)=>s+(e.durationMs||0),0),
      color: COLORS[i%COLORS.length]
    })).filter(p=>p.ms>0).sort((a,b)=>b.ms-a.ms).slice(0,8);
    const noProj = entries.filter(e=>!e.projectId).reduce((s,e)=>s+(e.durationMs||0),0);
    if (noProj > 0) projData.push({ name:'(no project)', ms: noProj, color: '#504945' });
    const pCvs = $('statsProjChart');
    requestAnimationFrame(() => drawDonut(pCvs,
      projData.map(p=>p.name), projData.map(p=>msToHrs(p.ms)), projData.map(p=>p.color), 180));

    // ── Day-of-week horizontal bar ─────────────────────────
    const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dowMs = Array(7).fill(0);
    entries.forEach(e => {
      let d = new Date(e.startTime).getDay(); // 0=Sun
      d = d === 0 ? 6 : d-1; // Mon=0
      dowMs[d] += e.durationMs||0;
    });
    const dowCvs = $('statsDowChart');
    requestAnimationFrame(() => drawHBarChart(dowCvs, DOW, dowMs.map(msToHrs), COLORS, 7*28+20));

    // ── Hour-of-day heatmap ────────────────────────────────
    const hourMs = Array(24).fill(0);
    entries.forEach(e => {
      hourMs[new Date(e.startTime).getHours()] += e.durationMs||0;
    });
    const maxHour = Math.max(...hourMs, 1);
    const hmDiv = $('statsHourHeatmap'); hmDiv.innerHTML = '';
    // Group into rows of 12 hours
    [[0,12,'00–11'],[12,24,'12–23']].forEach(([start, end, rowLabel]) => {
      const row = document.createElement('div'); row.className = 'shh-row';
      const lbl = document.createElement('div'); lbl.className = 'shh-lbl'; lbl.textContent = rowLabel;
      row.appendChild(lbl);
      const cells = document.createElement('div'); cells.className = 'shh-cells';
      for (let h = start; h < end; h++) {
        const cell = document.createElement('div'); cell.className = 'shh-cell';
        const intensity = hourMs[h] / maxHour;
        cell.style.background = `rgba(104,157,106,${intensity.toFixed(2)})`;
        cell.title = `${String(h).padStart(2,'0')}:00 — ${hourMs[h] ? msToPretty(hourMs[h]) : 'no data'}`;
        cells.appendChild(cell);
      }
      row.appendChild(cells); hmDiv.appendChild(row);
    });
    // X-axis labels — one shared row showing hour numbers
    const xrow = document.createElement('div'); xrow.className = 'shh-row';
    const xlbl = document.createElement('div'); xlbl.className = 'shh-lbl'; xrow.appendChild(xlbl);
    const xcells = document.createElement('div'); xcells.className = 'shh-cells';
    for (let h = 0; h < 12; h++) {
      const xl = document.createElement('div'); xl.className = 'shh-xlabel';
      xl.textContent = h % 3 === 0 ? String(h).padStart(2,'0') : '';
      xcells.appendChild(xl);
    }
    xrow.appendChild(xcells); hmDiv.appendChild(xrow);
    // Second row label (12–23)
    const xrow2 = document.createElement('div'); xrow2.className = 'shh-row';
    const xlbl2 = document.createElement('div'); xlbl2.className = 'shh-lbl'; xrow2.appendChild(xlbl2);
    const xcells2 = document.createElement('div'); xcells2.className = 'shh-cells';
    for (let h = 12; h < 24; h++) {
      const xl = document.createElement('div'); xl.className = 'shh-xlabel';
      xl.textContent = h % 3 === 0 ? String(h).padStart(2,'0') : '';
      xcells2.appendChild(xl);
    }
    xrow2.appendChild(xcells2); hmDiv.appendChild(xrow2);

    // ── Pomo session chart (work vs breaks) — single draw ──
    const pomoModes = ['work','short','long'];
    const pomoCounts = pomoModes.map(m => pomoLog.filter(s=>s.mode===m).length);
    const pomoCvs = $('statsPomoChart');
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const W = cvsW(pomoCvs); if (!W) return;
      const H = 3*28+20;
      pomoCvs.width = W*dpr; pomoCvs.height = H*dpr;
      pomoCvs.style.width = W+'px'; pomoCvs.style.height = H+'px';
      const ctx = pomoCvs.getContext('2d'); ctx.scale(dpr,dpr);
      const maxC = Math.max(...pomoCounts, 1);
      const labW = 76, barZone = W - labW - 64;
      const rowColors = ['#fb4934','#b8bb26','#83a598'];
      const rowLabels = ['WORK','SHORT BRK','LONG BRK'];
      rowLabels.forEach((lbl,i) => {
        const y = 10 + i*26, v = pomoCounts[i];
        const bW = Math.max(0, barZone * v / maxC);
        if (bW > 0) {
          const rr = Math.min(3, bW/2);
          ctx.fillStyle = rowColors[i]+'88';
          ctx.beginPath();
          ctx.moveTo(labW+rr,y); ctx.lineTo(labW+bW-rr,y);
          ctx.quadraticCurveTo(labW+bW,y,labW+bW,y+rr);
          ctx.lineTo(labW+bW,y+12); ctx.lineTo(labW,y+12);
          ctx.lineTo(labW,y+rr); ctx.quadraticCurveTo(labW,y,labW+rr,y); ctx.fill();
        }
        ctx.fillStyle = '#a89984'; ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'right'; ctx.fillText(lbl, labW-4, y+10);
        ctx.fillStyle = v > 0 ? '#ebdbb2' : '#504945'; ctx.textAlign = 'left';
        ctx.fillText(v > 0 ? `${v} session${v!==1?'s':''}` : 'none yet', labW+bW+6, y+10);
      });
    });

    // ── Duration distribution histogram — single draw ─────
    const durations  = entries.map(e => (e.durationMs||0)/60000); // minutes
    const buckets    = [0,5,10,15,20,30,45,60,90,120,180,240];
    const buckLabels = buckets.slice(0,-1).map((b,i)=>`${b}–${buckets[i+1]}`);
    const buckCounts = new Array(buckets.length-1).fill(0);
    durations.forEach(d => {
      for (let i = 0; i < buckets.length-1; i++) {
        if (d >= buckets[i] && d < buckets[i+1]) { buckCounts[i]++; break; }
      }
    });
    const durCvs = $('statsDurChart');
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const W = cvsW(durCvs); if (!W) return;
      const H = 180;
      durCvs.width = W*dpr; durCvs.height = H*dpr;
      durCvs.style.width = W+'px'; durCvs.style.height = H+'px';
      const ctx = durCvs.getContext('2d'); ctx.scale(dpr,dpr);
      const pad = {top:8, right:8, bottom:28, left:36};
      const cW = W-pad.left-pad.right, cH = H-pad.top-pad.bottom;
      const maxC = Math.max(...buckCounts, 1);
      const slotW = cW / buckCounts.length;
      const barW  = Math.max(3, slotW - 3);
      // Y gridlines + labels
      for (let si = 0; si <= 4; si++) {
        const v = Math.ceil(maxC*si/4);
        const y = pad.top + cH - (cH*si/4);
        ctx.strokeStyle = '#50494533'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
        ctx.fillStyle = '#665c54'; ctx.font = '8px JetBrains Mono,monospace'; ctx.textAlign = 'right';
        ctx.fillText(String(v), pad.left-3, y+3);
      }
      // Bars
      buckCounts.forEach((c,i) => {
        const x  = pad.left + slotW*i + (slotW-barW)/2;
        const bH = cH * (c/maxC);
        const y  = pad.top + cH - bH;
        if (c > 0) {
          const r = Math.min(3,barW/2);
          ctx.fillStyle = '#d3869b88';
          ctx.beginPath();
          ctx.moveTo(x+r,y); ctx.lineTo(x+barW-r,y);
          ctx.quadraticCurveTo(x+barW,y,x+barW,y+r);
          ctx.lineTo(x+barW,y+bH); ctx.lineTo(x,y+bH);
          ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.fill();
          // count label on tall bars
          if (bH > 16) {
            ctx.fillStyle = '#ebdbb2'; ctx.font = '8px JetBrains Mono,monospace'; ctx.textAlign = 'center';
            ctx.fillText(String(c), x+barW/2, y+10);
          }
        }
        // X label every 2nd
        if (i % 2 === 0) {
          ctx.fillStyle = '#504945'; ctx.font = '7px JetBrains Mono,monospace'; ctx.textAlign = 'center';
          ctx.fillText(buckLabels[i]+'m', x+barW/2, H-pad.bottom+10);
        }
      });
    });

    // ── Statistical summary ────────────────────────────────
    const durSecs = entries.map(e=>(e.durationMs||0)/1000);
    const dayHrs  = dayVals;
    const corr    = pearson(dayHrs.slice(0,-1), dayVals.slice(1)); // lag-1 autocorrelation
    const { slope } = linReg(dayHrs.map((_,i)=>i), dayHrs);
    const coeffVar  = statStdDev(dayHrs) / (statMean(dayHrs)||1);
    const peakHour  = hourMs.indexOf(Math.max(...hourMs));

    const mathItems = [
      { key:'Mean session',    val:msToPretty(statMean(durSecs)*1000),    hint:'average duration per entry' },
      { key:'Median session',  val:msToPretty(statMedian(durSecs)*1000),  hint:'50th percentile duration' },
      { key:'Std deviation',   val:msToPretty(statStdDev(durSecs)*1000),  hint:'consistency spread' },
      { key:'Longest session', val:msToPretty(statMax(durSecs)*1000),     hint:'single block record' },
      { key:'Shortest session',val:msToPretty((statMin(durSecs.filter(v=>v>0))||0)*1000), hint:'minimum tracked' },
      { key:'Daily mean',      val:msToPretty(statMean(dayHrs)*3600000),  hint:'average hrs/day tracked' },
      { key:'Daily σ (std)',   val:msToPretty(statStdDev(dayHrs)*3600000),hint:'day-to-day variance' },
      { key:'CV (consistency)',val:(coeffVar*100).toFixed(0)+'%',          hint:'lower = more consistent' },
      { key:'Trend (slope)',   val:(slope>=0?'+':'')+msToPretty(Math.abs(slope)*3600000)+'/day', hint:'daily time trend' },
      { key:'Lag-1 autocorr', val:corr.toFixed(3),                        hint:'momentum effect' },
      { key:'Peak hour',       val:`${String(peakHour).padStart(2,'0')}:00`, hint:'most productive hour' },
      { key:'Total entries',   val:String(entries.length),                 hint:'time blocks tracked' },
    ];
    const mg = $('statsMathGrid'); mg.innerHTML = '';
    mathItems.forEach(item => {
      const el = document.createElement('div'); el.className = 'stats-math-item';
      el.innerHTML = `<div class="stats-math-key">${item.key}</div><div class="stats-math-val">${item.val}</div><div class="stats-math-hint">${item.hint}</div>`;
      // Color the trend
      if (item.key === 'Trend (slope)') el.style.borderLeftColor = slope >= 0 ? '#b8bb26' : '#fb4934';
      if (item.key === 'Lag-1 autocorr') el.style.borderLeftColor = Math.abs(corr) > 0.5 ? '#fabd2f' : '#504945';
      mg.appendChild(el);
    });

    // ── Insights ──────────────────────────────────────────
    const insights = [];
    const bestDow = dowMs.indexOf(Math.max(...dowMs));
    if (dowMs[bestDow] > 0) insights.push({ icon:'🏆', text:`Your most productive day of the week is <strong style="color:var(--yellow-b)">${DOW[bestDow]}</strong> — ${msToPretty(dowMs[bestDow])} tracked on average.` });
    if (slope > 0) insights.push({ icon:'📈', text:`Your tracked time is trending <strong style="color:var(--green-b)">upward</strong> by ${msToPretty(Math.abs(slope)*3600000)} per day over the selected period.` });
    else if (slope < -0.01) insights.push({ icon:'📉', text:`Your tracked time is trending <strong style="color:var(--red-b)">downward</strong> by ${msToPretty(Math.abs(slope)*3600000)} per day. Consider a refocus session!` });
    if (coeffVar < 0.3 && entries.length > 5) insights.push({ icon:'🎯', text:`Excellent consistency! Your CV of ${(coeffVar*100).toFixed(0)}% indicates very stable daily productivity.` });
    else if (coeffVar > 0.8 && entries.length > 5) insights.push({ icon:'⚡', text:`High variability in daily time (CV: ${(coeffVar*100).toFixed(0)}%). Try setting a minimum daily target for stability.` });
    if (Math.abs(corr) > 0.4) insights.push({ icon:'🔗', text:`Strong momentum detected (autocorr: ${corr.toFixed(2)}). ${corr>0?'Good days tend to follow good days.':'Burnout pattern possible — alternate intensity.'}`});
    if (peakHour >= 6 && peakHour < 12) insights.push({ icon:'🌅', text:`You do your best work in the <strong style="color:var(--aqua-b)">morning</strong> (peak: ${String(peakHour).padStart(2,'0')}:00). Protect those hours.` });
    else if (peakHour >= 20 || peakHour < 4) insights.push({ icon:'🌙', text:`You're a <strong style="color:var(--blue-b)">night owl</strong> — peak productivity at ${String(peakHour).padStart(2,'0')}:00. Consider your sleep schedule.` });
    if (curStreak >= 7) insights.push({ icon:'🔥', text:`You're on a <strong style="color:var(--orange,#fe8019)">${curStreak}-day streak</strong>! Keep it going — streaks build powerful habits.` });
    if (!insights.length) insights.push({ icon:'💡', text:'Track more sessions to unlock personalized insights and pattern analysis.' });

    const insDiv = $('statsInsights'); insDiv.innerHTML = '';
    insights.forEach(ins => {
      const el = document.createElement('div'); el.className = 'stats-insight-item';
      el.innerHTML = `<span class="stats-insight-icon">${ins.icon}</span><span>${ins.text}</span>`;
      insDiv.appendChild(el);
    });

    // ── Weather section ────────────────────────────────────
    buildWeatherSection();
  };

  // ── Weather × Productivity ────────────────────────────────
  const buildWeatherSection = () => {
    window._buildWeatherSection = buildWeatherSection;
    const hist = window.wxLoad ? window.wxLoad() : [];
    const wrapEl   = $('statsWeatherWrap');
    const promptEl = $('statsWxPrompt');

    if (!hist.length) {
      if (wrapEl)   wrapEl.style.display   = 'none';
      if (promptEl) promptEl.style.display = 'flex';
      return;
    }
    if (wrapEl)   wrapEl.style.display   = 'block';
    if (promptEl) promptEl.style.display = 'none';

    // Latest snapshot
    const latest = hist[hist.length - 1];
    const info   = window.wxInfo(latest.code);
    $('statsWeatherIcon').textContent  = info.e;
    $('statsWxUpdated').textContent    = `· updated ${new Date(latest.ts).toLocaleTimeString()}`;

    // Current conditions chips
    $('statsWxCurrent').innerHTML = `
      <div class="wx-chip wx-temp"><span class="wx-chip-icon">🌡️</span>${latest.temp}°C <span class="wx-chip-sub">feels ${latest.feels}°C</span></div>
      <div class="wx-chip wx-humid"><span class="wx-chip-icon">💧</span>${latest.humid}% <span class="wx-chip-sub">humidity</span></div>
      <div class="wx-chip wx-wind"><span class="wx-chip-icon">💨</span>${latest.wind} km/h <span class="wx-chip-sub">wind</span></div>
      <div class="wx-chip wx-precip"><span class="wx-chip-icon">🌧️</span>${latest.precip} mm <span class="wx-chip-sub">precip</span></div>
      <div class="wx-chip wx-desc"><span class="wx-chip-icon">${info.e}</span>${info.l}</div>`;

    // ── Build per-day data (weather snapshot matched to tracked hours) ──
    const dayMap = {};  // key → { hrs, temps:[], humids:[], precips:[], winds:[], codes:[] }
    hist.forEach(s => {
      if (!dayMap[s.date]) dayMap[s.date] = { hrs:0, temps:[], humids:[], precips:[], winds:[], codes:[] };
      dayMap[s.date].temps.push(s.temp);
      dayMap[s.date].humids.push(s.humid);
      dayMap[s.date].precips.push(s.precip);
      dayMap[s.date].winds.push(s.wind);
      dayMap[s.date].codes.push(s.code);
    });
    timeEntries.forEach(e => {
      const k = new Date(e.startTime).toISOString().slice(0,10);
      if (dayMap[k]) dayMap[k].hrs += (e.durationMs||0) / 3600000;
    });

    // Aggregated per day: avg temp, avg humid, sum precip, dominant code
    const days = Object.entries(dayMap).map(([date, d]) => ({
      date,
      hrs:    d.hrs,
      temp:   d.temps.reduce((s,v)=>s+v,0) / d.temps.length,
      humid:  d.humids.reduce((s,v)=>s+v,0) / d.humids.length,
      precip: d.precips.reduce((s,v)=>s+v,0),
      wind:   d.winds.reduce((s,v)=>s+v,0) / d.winds.length,
      cat:    window.wxInfo(Math.round(d.codes.reduce((s,v)=>s+v,0)/d.codes.length)).cat,
    })).sort((a,b)=>a.date.localeCompare(b.date));

    const paired = days.filter(d => d.hrs > 0 && d.temps.length > 0);

    // ── Pearson helper ─────────────────────────────────────
    const rr = (xs, ys) => {
      const n = xs.length; if (n < 3) return null;
      const mx = xs.reduce((s,v)=>s+v,0)/n, my = ys.reduce((s,v)=>s+v,0)/n;
      const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
      const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
      return den ? +(num/den).toFixed(3) : null;
    };
    const rTemp   = rr(paired.map(d=>d.temp),  paired.map(d=>d.hrs));
    const rHumid  = rr(paired.map(d=>d.humid), paired.map(d=>d.hrs));
    const rPrecip = rr(paired.map(d=>d.precip),paired.map(d=>d.hrs));
    const rWind   = rr(paired.map(d=>d.wind),  paired.map(d=>d.hrs));

    // ── Chart 1: Dual-axis — bars=hours, line=temperature ──
    const dualCvs = $('statsWxDualChart');
    const last14  = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
      const k = d.toISOString().slice(0,10);
      last14.push({ label: i===0?'Today':String(d.getDate()), ...dayMap[k] || { hrs:0, temps:[], humids:[], precips:[], winds:[], codes:[] } });
    }
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const W = cvsW(dualCvs); if (!W) return;
      const H = 140;
      dualCvs.width  = W*dpr; dualCvs.height = H*dpr;
      dualCvs.style.width  = W+'px'; dualCvs.style.height = H+'px';
      const ctx = dualCvs.getContext('2d'); ctx.scale(dpr, dpr);
      const pad = { top:12, right:46, bottom:22, left:42 };
      const cW  = W - pad.left - pad.right;
      const cH  = H - pad.top  - pad.bottom;
      const hrs  = last14.map(d=>d.hrs);
      const maxH = Math.max(...hrs, 0.1);
      const temps = last14.map(d => d.temps?.length ? d.temps.reduce((s,v)=>s+v,0)/d.temps.length : null);
      const validTemps = temps.filter(t => t !== null);
      const minT = validTemps.length ? Math.min(...validTemps) - 2 : 0;
      const maxT = validTemps.length ? Math.max(...validTemps) + 2 : 30;
      const gap  = cW / 14, bW = Math.max(3, gap - 3);

      // Y gridlines (hours, left axis)
      for (let i = 0; i <= 3; i++) {
        const v = maxH * i/3;
        const y = pad.top + cH - (cH * i/3);
        ctx.strokeStyle = '#3c383655'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#665c54'; ctx.font = '8px JetBrains Mono,monospace'; ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(1)+'h', pad.left - 3, y + 3);
      }

      // Bars (hours)
      last14.forEach((d, i) => {
        const x   = pad.left + gap*i + (gap - bW)/2;
        const bH  = cH * (d.hrs / maxH);
        const col = i === 13 ? '#8ec07c' : '#45858877';
        if (d.hrs > 0) {
          const r = Math.min(3, bW/2);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(x+r, pad.top+cH-bH); ctx.lineTo(x+bW-r, pad.top+cH-bH);
          ctx.quadraticCurveTo(x+bW, pad.top+cH-bH, x+bW, pad.top+cH-bH+r);
          ctx.lineTo(x+bW, pad.top+cH); ctx.lineTo(x, pad.top+cH);
          ctx.lineTo(x, pad.top+cH-bH+r); ctx.quadraticCurveTo(x, pad.top+cH-bH, x+r, pad.top+cH-bH);
          ctx.fill();
        }
        // X label
        if (i % 2 === 0 || i === 13) {
          ctx.fillStyle = '#504945'; ctx.font = '7px JetBrains Mono,monospace'; ctx.textAlign = 'center';
          ctx.fillText(d.label, x + bW/2, H - pad.bottom + 10);
        }
      });

      // Temperature line (right axis)
      ctx.strokeStyle = '#fe8019'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      last14.forEach((d, i) => {
        if (!d.temps?.length) return;
        const t   = d.temps.reduce((s,v)=>s+v,0) / d.temps.length;
        const x   = pad.left + gap*i + gap/2;
        const y   = pad.top  + cH - cH * (t - minT) / (maxT - minT);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started=true);
      });
      ctx.stroke();
      // Temperature dots
      last14.forEach((d, i) => {
        if (!d.temps?.length) return;
        const t = d.temps.reduce((s,v)=>s+v,0)/d.temps.length;
        const x = pad.left + gap*i + gap/2;
        const y = pad.top  + cH - cH * (t - minT) / (maxT - minT);
        ctx.fillStyle = '#fe8019';
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2*Math.PI); ctx.fill();
      });
      // Right axis labels (temperature)
      ctx.fillStyle = '#fe801999'; ctx.textAlign = 'left'; ctx.font = '8px JetBrains Mono,monospace';
      for (let i = 0; i <= 3; i++) {
        const t = minT + (maxT-minT)*i/3;
        const y = pad.top + cH - cH*i/3;
        ctx.fillText(t.toFixed(0)+'°', W - pad.right + 3, y + 3);
      }
      // Legend
      ctx.fillStyle = '#45858877'; ctx.fillRect(pad.left, 2, 10, 7);
      ctx.fillStyle = '#a89984'; ctx.font = '8px JetBrains Mono,monospace'; ctx.textAlign = 'left';
      ctx.fillText('hours', pad.left + 13, 9);
      ctx.strokeStyle = '#fe8019'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(W - pad.right - 60, 5); ctx.lineTo(W - pad.right - 50, 5); ctx.stroke();
      ctx.fillText('temp', W - pad.right - 47, 9);
    });

    // ── Chart 2: Productivity by weather category ──────────
    const catCvs = $('statsWxCatChart');
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const W   = cvsW(catCvs); if (!W) return;
      const H   = 160;
      catCvs.width  = W*dpr; catCvs.height = H*dpr;
      catCvs.style.width = W+'px'; catCvs.style.height = H+'px';
      const ctx = catCvs.getContext('2d'); ctx.scale(dpr,dpr);

      const cats    = ['clear','cloudy','rain','snow','storm'];
      const catLabels = ['☀ Clear','⛅ Cloudy','🌧 Rain','❄ Snow','⛈ Storm'];
      const catColors = ['#fabd2f','#83a598','#458588','#d3869b','#fb4934'];
      const catAvg = cats.map(cat => {
        const matching = paired.filter(d => d.cat === cat);
        return matching.length ? matching.reduce((s,d)=>s+d.hrs,0)/matching.length : 0;
      });
      const maxAvg = Math.max(...catAvg, 0.1);
      const labW = 70, bMaxW = W - labW - 50;

      cats.forEach((cat, i) => {
        const y   = 12 + i * 28;
        const bW  = (catAvg[i] / maxAvg) * bMaxW;
        const cnt = paired.filter(d=>d.cat===cat).length;
        ctx.fillStyle = '#504945'; ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'right';
        ctx.fillText(catLabels[i], labW - 4, y + 11);
        if (bW > 0) {
          const r = Math.min(3, bW/2);
          ctx.fillStyle = catColors[i] + '88';
          ctx.beginPath();
          ctx.moveTo(labW+r, y); ctx.lineTo(labW+bW-r, y);
          ctx.quadraticCurveTo(labW+bW, y, labW+bW, y+r);
          ctx.lineTo(labW+bW, y+14); ctx.lineTo(labW, y+14);
          ctx.lineTo(labW, y+r); ctx.quadraticCurveTo(labW, y, labW+r, y); ctx.fill();
        }
        ctx.fillStyle = catAvg[i] > 0 ? '#ebdbb2' : '#504945';
        ctx.textAlign = 'left'; ctx.font = '8px JetBrains Mono,monospace';
        ctx.fillText(catAvg[i] > 0 ? `${catAvg[i].toFixed(1)}h avg · ${cnt}d` : '—', labW + bW + 5, y + 11);
      });
    });

    // ── Chart 3: Scatter — temperature vs hours ────────────
    const scatCvs = $('statsWxScatter');
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const W   = cvsW(scatCvs); if (!W) return;
      const H   = 160;
      scatCvs.width  = W*dpr; scatCvs.height = H*dpr;
      scatCvs.style.width = W+'px'; scatCvs.style.height = H+'px';
      const ctx = scatCvs.getContext('2d'); ctx.scale(dpr,dpr);
      const pad = { top:10, right:14, bottom:26, left:34 };
      const cW  = W - pad.left - pad.right;
      const cH  = H - pad.top  - pad.bottom;

      if (paired.length < 3) {
        ctx.fillStyle = '#504945'; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'center';
        ctx.fillText(`Need ${3 - paired.length} more matched days`, W/2, H/2);
        return;
      }

      const xs = paired.map(d=>d.temp), ys = paired.map(d=>d.hrs);
      const minX = Math.min(...xs)-2, maxX = Math.max(...xs)+2;
      const maxY = Math.max(...ys, 0.1);
      const catColors = { clear:'#fabd2f', cloudy:'#83a598', rain:'#458588', snow:'#d3869b', storm:'#fb4934', unknown:'#665c54' };

      // Grid
      for (let i = 0; i <= 3; i++) {
        const y = pad.top + cH*(1 - i/3);
        ctx.strokeStyle = '#3c383644'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
        ctx.fillStyle = '#665c54'; ctx.font = '7px JetBrains Mono,monospace'; ctx.textAlign = 'right';
        ctx.fillText((maxY*i/3).toFixed(1)+'h', pad.left-2, y+3);
      }
      for (let i = 0; i <= 4; i++) {
        const x = pad.left + cW*i/4;
        ctx.strokeStyle = '#3c383622'; ctx.beginPath(); ctx.moveTo(x,pad.top); ctx.lineTo(x,pad.top+cH); ctx.stroke();
        const t = minX + (maxX-minX)*i/4;
        ctx.fillStyle = '#665c54'; ctx.textAlign = 'center'; ctx.font = '7px JetBrains Mono,monospace';
        ctx.fillText(t.toFixed(0)+'°', x, H-pad.bottom+10);
      }

      // Trend line
      const n=xs.length, mx=xs.reduce((s,v)=>s+v,0)/n, my=ys.reduce((s,v)=>s+v,0)/n;
      const slope=(xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0))/(xs.reduce((s,x)=>s+(x-mx)**2,0)||1);
      const intc = my - slope*mx;
      ctx.strokeStyle = '#fabd2f44'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.beginPath();
      ctx.moveTo(pad.left,         pad.top + cH - cH*Math.max(0, slope*minX+intc)/maxY);
      ctx.lineTo(W-pad.right,      pad.top + cH - cH*Math.max(0, slope*maxX+intc)/maxY);
      ctx.stroke(); ctx.setLineDash([]);

      // Dots
      paired.forEach(d => {
        const x = pad.left + cW*(d.temp-minX)/(maxX-minX);
        const y = pad.top  + cH - cH*(d.hrs/maxY);
        ctx.fillStyle = (catColors[d.cat]||'#665c54') + 'cc';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 2*Math.PI); ctx.fill();
        ctx.strokeStyle = '#28282844'; ctx.lineWidth = 0.5; ctx.stroke();
      });

      // r label
      if (rTemp !== null) {
        ctx.fillStyle = '#a89984'; ctx.textAlign = 'right'; ctx.font = '8px JetBrains Mono,monospace';
        ctx.fillText(`r = ${rTemp}`, W-pad.right, pad.top+9);
      }
    });

    // ── Correlation matrix ─────────────────────────────────
    const corrGrid = $('statsWxCorrGrid');
    const rStrength = r => {
      if (r === null) return { label:'—', color:'#504945' };
      const a = Math.abs(r);
      if (a > 0.7)  return { label: r > 0 ? 'Strong ↑' : 'Strong ↓',   color: r > 0 ? '#b8bb26' : '#fb4934' };
      if (a > 0.4)  return { label: r > 0 ? 'Moderate ↑':'Moderate ↓', color: r > 0 ? '#fabd2f' : '#fe8019' };
      if (a > 0.2)  return { label: r > 0 ? 'Weak ↑':'Weak ↓',         color: '#83a598' };
      return { label: 'No correlation', color: '#504945' };
    };
    const factors = [
      { name:'Temperature (°C)',  r: rTemp,   icon:'🌡️', note:'Warmer = more/less focused?' },
      { name:'Humidity (%)',      r: rHumid,  icon:'💧', note:'Does humidity affect energy?' },
      { name:'Precipitation(mm)', r: rPrecip, icon:'🌧️', note:'Rain days vs dry days output' },
      { name:'Wind speed(km/h)',  r: rWind,   icon:'💨', note:'Gusty vs calm conditions'     },
    ];
    corrGrid.innerHTML = '';
    factors.forEach(f => {
      const s = rStrength(f.r);
      const bar = f.r !== null ? `<div class="wx-corr-bar" style="width:${Math.abs(f.r)*100}%;background:${s.color}44"></div>` : '';
      const el = document.createElement('div'); el.className = 'wx-corr-row';
      el.innerHTML = `
        <span class="wx-corr-icon">${f.icon}</span>
        <div class="wx-corr-body">
          <div class="wx-corr-name">${f.name}</div>
          <div class="wx-corr-track">${bar}</div>
          <div class="wx-corr-note">${f.note}</div>
        </div>
        <div class="wx-corr-stat">
          <div class="wx-corr-r" style="color:${s.color}">${f.r !== null ? f.r : '—'}</div>
          <div class="wx-corr-lbl" style="color:${s.color}">${s.label}</div>
        </div>`;
      corrGrid.appendChild(el);
    });

    // ── Weather insights ───────────────────────────────────
    const wxIns = [];
    if (rTemp !== null) {
      const s = rStrength(rTemp);
      if (Math.abs(rTemp) > 0.3) wxIns.push({ icon:'🌡️', text:`Temperature ${rTemp > 0 ? '<strong style="color:var(--green-b)">positively</strong>' : '<strong style="color:var(--red-b)">negatively</strong>'} correlates with your productivity (r=${rTemp}). ${rTemp > 0 ? 'You work more on warmer days.' : 'Cooler days seem to boost your focus.'}` });
    }
    if (rHumid !== null && Math.abs(rHumid) > 0.3) {
      wxIns.push({ icon:'💧', text:`Humidity ${rHumid < 0 ? 'reduces' : 'increases'} your tracked time (r=${rHumid}). ${rHumid < 0 ? 'High humidity days show lower productivity.' : 'Humid conditions seem to keep you indoors and focused.'}` });
    }
    if (rPrecip !== null && Math.abs(rPrecip) > 0.3) {
      wxIns.push({ icon:'🌧️', text:`Rainy days ${rPrecip > 0 ? '<strong>boost</strong> your focus' : 'tend to <strong>distract</strong> you'} (r=${rPrecip}). Great data point for planning deep work.` });
    }
    const clearDays  = paired.filter(d=>d.cat==='clear');
    const rainyDays  = paired.filter(d=>d.cat==='rain');
    const clearAvg   = clearDays.length  ? clearDays.reduce((s,d)=>s+d.hrs,0)/clearDays.length   : null;
    const rainyAvg   = rainyDays.length  ? rainyDays.reduce((s,d)=>s+d.hrs,0)/rainyDays.length   : null;
    if (clearAvg && rainyAvg) {
      const diff = Math.abs(clearAvg - rainyAvg);
      if (diff > 0.3) wxIns.push({ icon:'📊', text:`You track ${diff.toFixed(1)}h ${clearAvg > rainyAvg ? 'more on ☀ clear days' : 'more on 🌧 rainy days'}. ${clearAvg > rainyAvg ? 'Good weather = outdoors, bad weather = desk time.' : 'Rain keeps you focused!'}` });
    }
    if (paired.length < 5) wxIns.push({ icon:'📈', text:`${paired.length} matched weather/productivity days so far — correlations will strengthen with more data.` });
    if (!wxIns.length) wxIns.push({ icon:'🌍', text:'No strong weather–productivity correlations detected yet. Keep tracking!' });

    const wxInsDiv = $('statsWxInsights'); wxInsDiv.innerHTML = '';
    wxIns.forEach(ins => {
      const el = document.createElement('div'); el.className = 'stats-insight-item';
      el.innerHTML = `<span class="stats-insight-icon">${ins.icon}</span><span>${ins.text}</span>`;
      wxInsDiv.appendChild(el);
    });
  };

  // ── Wire up range tabs ────────────────────────────────────
  document.querySelectorAll('.stats-range-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stats-range-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      statsRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
      requestAnimationFrame(() => requestAnimationFrame(buildStats));
    });
  });

  // ── Wire open button ──────────────────────────────────────
  $('openStatsBtn').addEventListener('click', () => {
    openM('statsModal');
    $('openStatsBtn').classList.add('active');
    // Double rAF: first frame starts modal animation, second frame fires after layout resolves
    requestAnimationFrame(() => requestAnimationFrame(buildStats));
  });

})(); // end initStats
