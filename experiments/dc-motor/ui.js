// The lesson's page furniture: chapter list, control panel, caption, the two dialogs. It reads `app.state`, calls
// `app.act.*` when something is pressed, and redraws itself in `sync()`. No physics and no 3D in here.
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

export function createUI(app) {
  const { state, chapters, experiments, quiz, act } = app;

  // ---- chapters
  const chapterButtons = chapters.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<i>${pad(i + 1)}</i><span>${c.title}</span>`;
    b.addEventListener('click', () => act.chapter(i, true));
    $('chapters').appendChild(b);
    return b;
  });
  $('prevBtn').addEventListener('click', () => act.chapter((state.chapter + chapters.length - 1) % chapters.length, true));
  $('nextBtn').addEventListener('click', () => act.chapter((state.chapter + 1) % chapters.length, true));

  // ---- controls
  $('switchBtn').addEventListener('click', act.toggleSwitch);
  $('pauseBtn').addEventListener('click', act.togglePause);
  $('explodeBtn').addEventListener('click', act.toggleExplode);
  $('nudgeBtn').addEventListener('click', act.nudge);
  $('supplyBtn').addEventListener('click', act.swapSupply);
  $('magnetBtn').addEventListener('click', act.swapMagnets);
  $('speed').addEventListener('input', (e) => act.speed(+e.target.value));
  $('current').addEventListener('input', (e) => act.param('current', +e.target.value / 100));
  $('field').addEventListener('input', (e) => act.param('field', +e.target.value / 100));
  const turnButtons = [...$('turns').querySelectorAll('button')];
  turnButtons.forEach((b) => b.addEventListener('click', () => act.param('turns', +b.dataset.turns)));
  const layerButtons = [...$('layers').querySelectorAll('button')];
  layerButtons.forEach((b) => b.addEventListener('click', () => act.layer(b.dataset.layer)));

  // ---- top bar
  $('autoBtn').addEventListener('click', act.toggleAuto);
  $('voiceBtn').addEventListener('click', act.toggleVoice);
  $('fullBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  $('drawerBtn').addEventListener('click', () => {
    const on = document.body.classList.toggle('drawer');
    $('drawerBtn').setAttribute('aria-pressed', on);
  });
  for (const d of document.querySelectorAll('dialog')) {
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('click', (e) => e.target === d && d.close()); // a click on the backdrop
  }

  // ---- experiments
  experiments.forEach((x, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<b>实验${'一二三四五六七八九'[i]} · ${x.title}</b><span>${x.goal}</span>`;
    b.addEventListener('click', () => {
      $('experimentDialog').close();
      act.experiment(i);
    });
    $('experimentCards').appendChild(b);
  });
  $('experimentBtn').addEventListener('click', () => $('experimentDialog').showModal());

  // ---- quiz
  const q = { i: 0, score: 0, answered: false };
  function drawQuiz() {
    const item = quiz[q.i];
    $('quizBar').firstElementChild.style.width = `${(q.i / quiz.length) * 100}%`;
    $('quizQ').textContent = `${q.i + 1}. ${item.q}`;
    $('quizExplain').textContent = '';
    $('quizScore').textContent = `第 ${q.i + 1} / ${quiz.length} 题 · 答对 ${q.score}`;
    $('quizNext').disabled = $('quizReplay').disabled = true;
    $('quizNext').textContent = q.i === quiz.length - 1 ? '再来一遍' : '下一题';
    q.answered = false;
    $('quizOptions').replaceChildren(
      ...item.options.map((text, k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${'ABC'[k]}. ${text}`;
        b.addEventListener('click', () => {
          if (q.answered) return;
          q.answered = true;
          if (k === item.a) q.score++;
          [...$('quizOptions').children].forEach((o, n) => o.classList.toggle('right', n === item.a));
          if (k !== item.a) b.classList.add('wrong');
          $('quizExplain').textContent = (k === item.a ? '答对了。' : '再想想。') + item.explain;
          $('quizScore').textContent = `第 ${q.i + 1} / ${quiz.length} 题 · 答对 ${q.score}`;
          $('quizBar').firstElementChild.style.width = `${((q.i + 1) / quiz.length) * 100}%`;
          $('quizNext').disabled = $('quizReplay').disabled = false;
        });
        return b;
      }),
    );
  }
  $('quizBtn').addEventListener('click', () => {
    drawQuiz();
    $('quizDialog').showModal();
  });
  $('quizNext').addEventListener('click', () => {
    if (q.i === quiz.length - 1) q.i = q.score = 0;
    else q.i++;
    drawQuiz();
  });
  $('quizReplay').addEventListener('click', () => {
    $('quizDialog').close();
    act.chapter(quiz[q.i].chapter, true);
  });

  // ---- drawing
  const press = (el, on) => el.setAttribute('aria-pressed', on ? 'true' : 'false');
  let toastTimer = 0;
  return {
    sync() {
      const c = chapters[state.chapter],
        p = state.params;
      chapterButtons.forEach((b, i) => b.setAttribute('aria-current', i === state.chapter ? 'true' : 'false'));
      $('capNo').textContent = `${pad(state.chapter + 1)} / ${pad(chapters.length)}`;
      $('capTitle').textContent = c.title;
      $('capGoal').textContent = c.goal;
      $('capText').textContent = c.text;
      $('capNote').textContent = c.note;
      $('formula').textContent = c.formula;
      const x = state.experiment === null ? null : experiments[state.experiment];
      $('task').hidden = !x;
      if (x) {
        $('task').innerHTML = `<b>实验：${x.title}</b>　${x.steps}<button type="button">${state.expectShown ? '收起结论' : '先想一想，再看结论'}</button>${state.expectShown ? `<span class="expect">${x.expect}</span>` : ''}`;
        $('task').querySelector('button').addEventListener('click', act.toggleExpect);
      }
      press($('switchBtn'), p.closed);
      $('switchBtn').textContent = p.closed ? '开关：合上' : '开关：断开';
      press($('pauseBtn'), state.paused);
      $('pauseBtn').textContent = state.paused ? '继续' : '暂停';
      press($('explodeBtn'), state.exploded);
      $('explodeBtn').textContent = state.exploded ? '装回去' : '拆开';
      press($('supplyBtn'), p.supply < 0);
      press($('magnetBtn'), p.magnet < 0);
      $('speed').value = state.speed;
      $('speedOut').textContent = `${state.speed.toFixed(2)}×`;
      $('current').value = Math.round(p.current * 100);
      $('currentOut').textContent = `${Math.round(p.current * 100)}%`;
      $('field').value = Math.round(p.field * 100);
      $('fieldOut').textContent = `${Math.round(p.field * 100)}%`;
      turnButtons.forEach((b) => press(b, +b.dataset.turns === p.turns));
      layerButtons.forEach((b) => press(b, state.layers[b.dataset.layer]));
      press($('autoBtn'), state.auto);
      press($('voiceBtn'), state.voice);
    },
    // r: { torque, speed, way, coil, status, perf }
    readout(r) {
      $('rTorque').textContent = r.torque;
      $('rSpeed').textContent = r.speed;
      $('rWay').textContent = r.way;
      $('rCoil').textContent = r.coil;
      if ($('status').textContent !== r.status) $('status').textContent = r.status;
      $('perf').textContent = r.perf;
    },
    toast(text, seconds = 2.4) {
      $('toast').textContent = text;
      $('toast').classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => $('toast').classList.remove('on'), seconds * 1000);
    },
  };
}

// Reads a chapter aloud with the browser's own voice, if it has a Chinese one. Returns a stop function.
export function speak(text, onEnd) {
  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) return () => {};
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 1;
  if (onEnd) u.onend = onEnd;
  synth.speak(u);
  return () => synth.cancel();
}
