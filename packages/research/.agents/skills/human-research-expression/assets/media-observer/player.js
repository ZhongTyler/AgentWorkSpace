(function (scope) {
  'use strict';
  const mounted = new WeakMap();
  const mediaOwners = new WeakMap();
  const clamp = (n, max) => Math.max(0, Math.min(max, n));
  function formatTime(n) {
    if (!Number.isFinite(n)) return '--:--';
    const ticks = Math.round(Math.max(0, n) * 100);
    return String(Math.floor(ticks / 6000)).padStart(2, '0') + ':' + ((ticks % 6000) / 100).toFixed(2).padStart(5, '0');
  }
  function markup(videoHTML) {
    return `<div class="media-observer" data-media-observer tabindex="0" aria-label="片段观察播放器">
      <div class="mo-screen">${videoHTML}</div>
      <div class="mo-panel">
        <div class="mo-top"><strong>片段观察</strong><span class="mo-hint">先看整体，再停下来查细节</span></div>
        <div class="mo-time"><output data-mo="clock">00:00.00</output><span>/</span><output data-mo="duration">--:--</output><span class="mo-speed-note" data-mo="speed-note">正常速度</span></div>
        <div class="mo-timeline"><div class="mo-range-band" aria-hidden="true"></div><input data-mo="scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="视频播放位置"></div>
        <div class="mo-transport">
          <button type="button" class="mo-jump" data-mo="back" aria-label="快退1秒"><b>−1秒</b><small>快退</small></button>
          <button type="button" class="mo-play" data-mo="play" aria-label="播放"><span data-mo="play-icon" aria-hidden="true">▶</span><span data-mo="play-label">播放</span></button>
          <button type="button" class="mo-jump" data-mo="forward" aria-label="快进1秒"><b>＋1秒</b><small>快进</small></button>
          <label class="mo-rate">播放速度<select data-mo="rate"><option value="1">正常 · 1倍</option><option value="0.5">慢放 · 0.5倍</option><option value="0.25">细看 · 0.25倍</option><option value="other" data-mo="external-rate" disabled hidden>备用控件速度</option></select></label>
          <button type="button" class="mo-text" data-mo="restart">回到开头</button>
        </div>
        <details class="mo-detail"><summary>逐步细看与区间回看</summary>
          <div class="mo-fine"><div><strong>暂停后细看</strong><small>时间步进，非精确逐帧</small><label class="mo-step-size">步长 <select data-mo="step-size"><option value="frame">约1/30秒</option><option value="quarter">0.25秒</option></select></label></div><div class="mo-step-pair"><button type="button" data-mo="step-back" aria-label="暂停并后退约1/30秒">← 后一步</button><button type="button" data-mo="step-forward" aria-label="暂停并前进约1/30秒">前一步 →</button></div></div>
          <div class="mo-loop-head"><strong>反复观察同一段</strong><label class="mo-loop-toggle"><input type="checkbox" data-mo="loop"> 循环此段</label></div>
          <div class="mo-boundaries"><label>起点 A <span><input data-mo="a" type="number" min="0" step="0.01" value="0" aria-label="区间起点秒数"><i>秒</i></span></label><button type="button" data-mo="set-a" title="将当前位置设为起点">取当前</button><span class="mo-between">至</span><label>终点 B <span><input data-mo="b" type="number" min="0" step="0.01" value="0" aria-label="区间终点秒数"><i>秒</i></span></label><button type="button" data-mo="set-b" title="将当前位置设为终点">取当前</button><button type="button" class="mo-text" data-mo="clear">重置区间</button></div>
          <p class="mo-loop-note" data-mo="loop-note">载入后可选择回看区间。</p>
        </details>
        <div class="mo-foot"><p class="mo-status" data-mo="status" role="status" aria-live="polite">点击播放载入片段。</p><button type="button" class="mo-text" data-mo="native">备用播放控件</button></div>
      </div>
    </div>`;
  }
  function createController(video, changed = () => {}) {
    const owner = { active: true }; mediaOwners.set(video, owner);
    let a = 0, b = null, loop = false, pending = false, destroyed = false, generation = 0, wantedPlay = false, notice = '点击播放载入片段。';
    const events = [];
    const ready = () => Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 1;
    const state = () => ({ ready: ready(), duration: ready() ? video.duration : 0, time: Number.isFinite(video.currentTime) ? video.currentTime : 0, rate: video.playbackRate || 1, playing: !video.paused && !video.ended, pending, a, b, loop, notice });
    const emit = message => { if (message !== undefined) notice = message; if (!destroyed) changed(state()); };
    const on = (name, fn) => { video.addEventListener(name, fn); events.push([name, fn]); };
    function ensure() { if (ready()) return true; emit('视频尚未载入，请先播放。'); return false; }
    function pause() { generation++; pending = false; wantedPlay = false; video.pause(); emit(); }
    async function play() {
      const id = ++generation; wantedPlay = true; pending = true; emit('正在开始播放…');
      try { await video.play(); if (destroyed) { const current = mediaOwners.get(video); if (current === owner || !current?.active) video.pause(); return; } if (id !== generation) { if (!wantedPlay) video.pause(); return; } pending = false; emit('正在播放。'); }
      catch (_) { if (!destroyed && id === generation) { pending = false; wantedPlay = false; emit('未能开始播放，请重试或切换备用播放控件。'); } }
    }
    function seek(value, stop = false) {
      if (!ensure() || !Number.isFinite(value)) return false;
      if (stop) pause();
      const target = clamp(value, video.duration);
      if (loop && (target < a || target >= b)) loop = false;
      video.currentTime = target; emit('已定位至 ' + formatTime(target) + (stop ? '，并暂停。' : '。')); return true;
    }
    function range(nextA, nextB) {
      if (!ensure()) return false;
      if (![nextA, nextB].every(Number.isFinite) || nextA < 0 || nextB > video.duration || nextB <= nextA) { emit('区间未修改：起点不得早于0秒，终点须更晚且不超出片段。'); return false; }
      a = nextA; b = nextB; loop = false; emit('已选择 ' + formatTime(a) + ' 至 ' + formatTime(b) + '。'); return true;
    }
    function reset() { if (!ensure()) return; a = 0; b = video.duration; loop = false; emit('已恢复整段范围，循环未开启。'); }
    function metadata() { if (ready()) { if (b === null || b > video.duration || a >= video.duration) { a = 0; b = video.duration; loop = false; } emit('片段已就绪。'); } }
    on('loadedmetadata', metadata); on('durationchange', metadata);
    on('timeupdate', () => { if (loop && b !== null && video.currentTime >= b) video.currentTime = a; emit(); });
    on('seeking', () => { if (loop && (video.currentTime < a || video.currentTime > b)) { loop = false; emit('已离开区间，循环关闭。'); } });
    on('play', () => emit()); on('pause', () => emit()); on('ratechange', () => emit());
    on('ended', () => { if (loop) { video.currentTime = a; void play(); } else emit('播放结束，可快退或回到开头。'); });
    on('error', () => { generation++; pending = false; wantedPlay = false; loop = false; emit('素材无法播放，请检查格式或原文件。'); });
    on('emptied', () => { generation++; pending = false; wantedPlay = false; a = 0; b = null; loop = false; emit('正在等待新片段。'); });
    if (ready()) metadata(); else emit();
    return {
      getState: state,
      togglePlay() { if (pending || !video.paused && !video.ended) { pause(); emit('已暂停。'); return Promise.resolve(); } return play(); },
      seek, jump(delta) { return seek(video.currentTime + delta); }, step(delta) { return seek(video.currentTime + delta, true); }, restart() { return seek(0, true); },
      setRate(value) { if (![1, 0.5, 0.25].includes(value)) return false; video.playbackRate = value; emit(value === 1 ? '正常速度观察整体节奏。' : value + '倍慢放，观察动作细节。'); return true; },
      setRange: range, setA(value) { return range(value, b === null ? video.duration : b); }, setB(value) { return range(a, value); }, resetRange: reset,
      setLoop(value) { if (!ensure() || b === null || b <= a) return false; loop = !!value; if (loop && (video.currentTime < a || video.currentTime >= b)) video.currentTime = a; emit(loop ? '循环已开启；播放时会在A至B之间回看。' : '循环已关闭。'); return true; },
      destroy() { const waiting = pending; destroyed = true; owner.active = false; generation++; pending = false; wantedPlay = false; events.forEach(([name, fn]) => video.removeEventListener(name, fn)); if (waiting && mediaOwners.get(video) === owner) video.pause(); }
    };
  }
  function mount(root) {
    if (mounted.has(root)) return mounted.get(root);
    const video = root.querySelector('video'), q = key => root.querySelector('[data-mo="' + key + '"]');
    if (!video || !q('play') || !q('scrub')) throw new Error('Incomplete media observer markup');
    const nativeControls = video.controls, bindings = [], actions = {}; let stepSize = 1 / 30;
    const bind = (el, event, fn) => { el.addEventListener(event, fn); bindings.push([el, event, fn]); };
    const controller = createController(video, s => {
      q('clock').textContent = formatTime(s.time); q('duration').textContent = formatTime(s.ready ? s.duration : NaN); q('speed-note').textContent = s.rate === 1 ? '正常速度' : s.rate + (s.rate < 1 ? '倍慢放' : '倍快放');
      q('play-label').textContent = s.pending ? '等待中' : s.playing ? '暂停' : '播放'; q('play-icon').textContent = s.playing || s.pending ? 'Ⅱ' : '▶'; q('play').setAttribute('aria-label', s.pending || s.playing ? '暂停' : '播放'); q('play').setAttribute('aria-busy', String(s.pending));
      q('scrub').value = s.ready ? Math.round(s.time / s.duration * 1000) : 0; q('scrub').setAttribute('aria-valuetext', formatTime(s.time) + '，共' + formatTime(s.duration));
      for (const key of ['scrub', 'back', 'forward', 'restart', 'step-back', 'step-forward', 'a', 'b', 'set-a', 'set-b', 'loop', 'clear']) q(key).disabled = !s.ready;
      const standardRate = [1, .5, .25].includes(s.rate); q('external-rate').hidden = standardRate; q('external-rate').textContent = s.rate + '倍 · 备用控件'; q('rate').value = standardRate ? String(s.rate) : 'other'; if (root.ownerDocument?.activeElement !== q('a')) q('a').value = s.a.toFixed(2); if (root.ownerDocument?.activeElement !== q('b')) q('b').value = s.b === null ? '' : s.b.toFixed(2); q('a').max = q('b').max = String(s.duration); q('loop').checked = s.loop;
      q('loop-note').textContent = s.b === null ? '载入后可选择回看区间。' : formatTime(s.a) + ' — ' + formatTime(s.b) + (s.loop ? ' · 循环开启' : ' · 勾选后循环');
      q('status').textContent = s.notice; root.classList.toggle('is-looping', s.loop); root.style.setProperty('--mo-progress', (s.ready ? s.time / s.duration * 100 : 0) + '%'); root.style.setProperty('--mo-a', (s.ready ? s.a / s.duration * 100 : 0) + '%'); root.style.setProperty('--mo-b', (s.ready && s.b !== null ? s.b / s.duration * 100 : 0) + '%');
    });
    actions.play = () => void controller.togglePlay(); actions.back = () => controller.jump(-1); actions.forward = () => controller.jump(1); actions.restart = () => controller.restart(); actions['step-back'] = () => controller.step(-stepSize); actions['step-forward'] = () => controller.step(stepSize); actions['set-a'] = () => controller.setA(video.currentTime); actions['set-b'] = () => controller.setB(video.currentTime); actions.clear = () => controller.resetRange();
    for (const [key, action] of Object.entries(actions)) bind(q(key), 'click', action);
    bind(q('rate'), 'change', () => controller.setRate(Number(q('rate').value)));
    bind(q('step-size'), 'change', () => { stepSize = q('step-size').value === 'quarter' ? .25 : 1 / 30; const unit = stepSize === .25 ? '0.25秒' : '约1/30秒'; q('step-back').setAttribute('aria-label', '暂停并后退' + unit); q('step-forward').setAttribute('aria-label', '暂停并前进' + unit); });
    bind(q('scrub'), 'input', () => { const s = controller.getState(); controller.seek(Number(q('scrub').value) / 1000 * s.duration, true); });
    bind(q('a'), 'change', () => { if (!controller.setA(Number(q('a').value))) q('a').value = controller.getState().a.toFixed(2); }); bind(q('b'), 'change', () => { if (!controller.setB(Number(q('b').value))) { const b = controller.getState().b; q('b').value = b === null ? '' : b.toFixed(2); } }); bind(q('loop'), 'change', () => controller.setLoop(q('loop').checked));
    bind(q('native'), 'click', () => { video.controls = !video.controls; q('native').textContent = video.controls ? '收起备用控件' : '备用播放控件'; });
    bind(root, 'keydown', event => { if (event.target !== root) return; if (event.code === 'Space') { event.preventDefault(); void controller.togglePlay(); } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); controller.jump(event.key === 'ArrowLeft' ? -1 : 1); } });
    video.controls = false; root.classList.add('is-mounted');
    const instance = { controller, destroy() { controller.destroy(); bindings.forEach(([el, event, fn]) => el.removeEventListener(event, fn)); video.controls = nativeControls; root.classList.remove('is-mounted'); mounted.delete(root); } };
    mounted.set(root, instance); return instance;
  }
  const api = { markup, mount, createController, formatTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.ResearchMediaObserver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
