const hero = document.querySelector('.hero');
const svg = document.getElementById('hero-match');

if (hero && svg) {
  const namespace = 'http://www.w3.org/2000/svg';
  const colors = ['#8fab7c', '#e9e9e5'];
  const formation = [[35,340],[200,115],[175,270],[175,410],[200,565],
    [400,180],[390,340],[400,500],[640,100],[745,340],[640,580]];
  const scenes = [
    {
      label: 'Penalty raté', duration: 5600, setup: 'penalty',
      ball: [[0,940,340],[1050,940,340],[1400,1020,285],[1800,1115,190]],
      movers: [
        { team: 0, index: 9, path: [[0,898,354],[650,898,354],[1050,923,340]] },
        { team: 1, index: 0, path: [[0,1015,340],[1050,1015,340],[1800,1015,388]] }
      ]
    },
    {
      label: 'Depuis le milieu… but !', duration: 5600, goalAt: 2400,
      ball: [[0,525,340],[1050,525,340],[1725,790,280],[2400,1066,376]],
      movers: [
        { team: 0, index: 6, path: [[0,483,354],[650,483,354],[1050,508,340]] },
        { team: 1, index: 0, path: [[0,1015,340],[1050,1015,340],[2400,1015,295]] }
      ]
    },
    {
      label: 'Coup franc… beaucoup trop loin', duration: 5600, setup: 'wall',
      ball: [[0,750,270],[1050,750,270],[1625,1100,70],[2200,1500,-260]],
      movers: [{ team: 0, index: 9, path: [[0,708,284],[650,708,284],[1050,733,270]] }]
    },
    {
      label: 'Corner, centre et but de l’attaquant', duration: 7800, goalAt: 4400, shotAt: 3800,
      ball: [[0,1040,12],[1000,1040,12],[1900,990,140],[2900,950,255],[3800,958,321],[4400,1066,350]],
      movers: [
        { team: 0, index: 8, path: [[0,1014,25],[650,1014,25],[1000,1030,22]] },
        { team: 0, index: 9, path: [[0,860,390],[1700,860,390],[2900,920,350],[3800,948,325],[4300,970,327]] },
        { team: 1, index: 0, path: [[0,1015,340],[2300,1015,340],[3400,990,300],[4400,1005,305]] }
      ]
    },
    {
      label: 'Contre-attaque : la vitesse fait la différence', duration: 9000, setup: 'counter', goalAt: 6000, shotAt: 5300,
      ball: [[0,270,325],[1000,270,325],[2300,600,310],[3400,865,300],[3900,890,305],[4700,955,330],[5300,990,345],[6000,1066,389]],
      movers: [
        { team: 0, index: 6, path: [[0,245,337],[650,245,337],[1000,259,326]] },
        { team: 0, index: 9, path: [[0,420,350],[1000,420,350],[2300,625,335],[3400,850,310],[3900,879,309],[4700,944,334],[5300,979,348]] },
        { team: 1, index: 2, path: [[0,650,275],[1500,650,275],[3400,805,280],[4700,885,300],[5600,920,320]] },
        { team: 1, index: 3, path: [[0,780,395],[1500,780,395],[3400,855,380],[4700,920,375],[5600,950,370]] },
        { team: 1, index: 0, path: [[0,1015,340],[3900,1015,340],[5300,1008,325],[6000,1010,290]] }
      ]
    },
    {
      label: 'Tiki-taka… presque !', duration: 9000, goalAt: null, shotAt: 5650,
      ball: [[0,650,285],[900,650,285],[1450,730,395],[1800,730,395],[2350,805,270],[2650,805,270],[3150,730,395],[3450,730,395],[4000,865,320],[4350,865,320],[4900,930,390],[5350,960,365],[5650,960,365],[6400,1090,440]],
      movers: [
        { team: 0, index: 6, path: [[0,638,285],[1800,638,285],[3450,760,300],[4000,853,320],[4900,900,335]] },
        { team: 0, index: 7, path: [[0,718,395],[3450,718,395],[4350,880,420],[4900,918,390],[5350,948,365],[5650,948,365]] },
        { team: 0, index: 8, path: [[0,793,270],[2650,793,270],[4000,830,245]] },
        { team: 1, index: 0, path: [[0,1015,340],[4900,1015,340],[6400,1010,390]] }
      ]
    },
    {
      label: 'Mauvaise relance du gardien… but !', duration: 7800, goalAt: 4300, shotAt: 3400,
      ball: [[0,1000,340],[1000,1000,340],[2200,850,345],[2650,850,345],[3400,930,365],[4300,1066,387]],
      movers: [
        { team: 1, index: 0, path: [[0,1015,340],[1000,1010,340],[2200,995,338],[3400,990,325],[4300,1015,315]] },
        { team: 0, index: 9, path: [[0,790,395],[1000,790,395],[2200,838,350],[2650,838,350],[3400,918,369]] }
      ]
    },
    {
      label: 'Deux contre le gardien : le caviar et le but', duration: 8200, goalAt: 4900, shotAt: 4300,
      ball: [[0,850,265],[1000,850,265],[2300,920,285],[2900,950,300],[3700,963,405],[4300,991,391],[4900,1066,395]],
      movers: [
        { team: 0, index: 8, path: [[0,838,265],[1000,838,265],[2300,908,285],[2900,938,300],[3900,955,290]] },
        { team: 0, index: 9, path: [[0,825,440],[1000,825,440],[2300,915,430],[3700,951,409],[4300,979,395]] },
        { team: 1, index: 0, path: [[0,1015,340],[1000,1015,340],[2300,984,300],[2900,973,285],[3700,990,310],[4900,1010,345]] }
      ]
    },
    {
      label: 'La passe traverse tout le terrain… tir juste à côté', duration: 9000, setup: 'long-pass', goalAt: null, shotAt: 5500,
      ball: [[0,180,390],[1000,180,390],[2400,490,355],[3900,865,310],[4450,890,315],[5100,965,330],[5500,988,340],[6200,1090,424]],
      movers: [
        { team: 0, index: 2, path: [[0,155,402],[650,155,402],[1000,169,391]] },
        { team: 0, index: 9, path: [[0,690,270],[1400,690,270],[3000,780,285],[3900,853,314],[4450,878,319],[5100,953,334],[5500,976,344]] },
        { team: 1, index: 0, path: [[0,1015,340],[4450,1015,340],[6200,1010,375]] }
      ]
    }
  ];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = window.matchMedia('(max-width: 699px)');
  let sceneIndex = 0, animations = [], timer = 0, remaining = scenes[0].duration, startedAt = 0;
  let visible = true, playing = false;

  function element(name, attributes, parent) {
    const node = document.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }

  const world = element('g', { class: 'match-field' }, svg);
  const pitch = element('g', { fill: 'none', stroke: '#b3c6b6', 'stroke-opacity': '.3', 'stroke-width': '2' }, world);
  element('rect', { width: 1050, height: 680 }, pitch);
  element('path', { d: 'M525 0V680 M0 138H165V542H0 M1050 138H885V542H1050 M0 248H55V432H0 M1050 248H995V432H1050' }, pitch);
  element('circle', { cx: 525, cy: 340, r: 90 }, pitch);
  element('circle', { cx: 525, cy: 340, r: 3, fill: '#b3c6b6', stroke: 'none' }, pitch);
  element('circle', { cx: 940, cy: 340, r: 3, fill: '#b3c6b6', stroke: 'none' }, pitch);
  for (const x of [-26, 1050]) {
    element('rect', { x, y: 270, width: 26, height: 140 }, pitch);
    for (let y = 280; y < 410; y += 13) element('path', { d: `M${x} ${y}h26`, 'stroke-opacity': '.12', 'stroke-width': '1' }, pitch);
  }
  const actors = element('g', {}, world);
  const sprites = document.createElement('div');
  sprites.className = 'match-sprites';
  sprites.setAttribute('aria-hidden', 'true');
  hero.append(sprites);

  function resize() {
    svg.setAttribute('viewBox', portrait.matches ? '0 0 780 1150' : '0 0 1150 780');
    world.setAttribute('transform', portrait.matches ? 'translate(730 50) rotate(90)' : 'translate(50 50)');
    const viewWidth = portrait.matches ? 780 : 1150;
    const viewHeight = portrait.matches ? 1150 : 780;
    const scale = Math.min(hero.clientWidth / viewWidth, hero.clientHeight / viewHeight);
    const left = (hero.clientWidth - viewWidth * scale) / 2;
    const top = (hero.clientHeight - viewHeight * scale) / 2;
    sprites.style.transform = `translate(${left}px, ${top}px) scale(${scale}) ` +
      (portrait.matches ? 'translate(730px, 50px) rotate(90deg)' : 'translate(50px, 50px)');
  }

  function player(x, y, team) {
    return element('circle', { cx: x, cy: y, r: 9, fill: colors[team], stroke: '#203b2b', 'stroke-width': 2 }, actors);
  }

  function animate(node, keyframes, length, delay = 0) {
    const animation = node.animate(keyframes, { duration: length, delay, fill: 'both', easing: 'linear' });
    animations.push(animation);
  }

  function sprite(x, y, color, radius, name) {
    const node = document.createElement('span');
    node.className = 'match-dot ' + name;
    Object.assign(node.style, { width: `${radius*2}px`, height: `${radius*2}px`, left: `${-radius}px`, top: `${-radius}px`, background: color, transform: `translate3d(${x}px, ${y}px, 0)` });
    sprites.append(node);
    return node;
  }

  function updatePlayback() {
    clearTimeout(timer);
    if (playing) remaining = Math.max(0, remaining - (performance.now() - startedAt));
    playing = false;
    const run = visible && !document.hidden && !reducedMotion.matches;
    for (const animation of animations) {
      if (animation.currentTime >= animation.effect.getComputedTiming().endTime) continue;
      run ? animation.play() : animation.pause();
    }
    if (run) {
      playing = true;
      startedAt = performance.now();
      timer = setTimeout(() => {
        playing = false;
        sceneIndex = (sceneIndex + 1) % scenes.length;
        remaining = scenes[sceneIndex].duration;
        drawScene();
      }, remaining);
    }
  }

  function drawScene() {
    clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    animations = [];
    actors.replaceChildren();
    sprites.replaceChildren();
    const scene = scenes[sceneIndex];
    svg.dataset.scene = scene.label;
    svg.dataset.duration = scene.duration;
    const position = (x, y) => `translate3d(${x}px, ${y}px, 0)`;
    const movingPlayers = new Set(scene.movers.map(move => `${move.team}:${move.index}`));
    for (const team of [0, 1]) {
      formation.forEach(([baseX, baseY], index) => {
        if (movingPlayers.has(`${team}:${index}`)) return;
        let x = team === 0 ? baseX : 1050 - baseX;
        let y = baseY;
        if (scene.setup === 'penalty' && index !== 0) x = Math.min(x, 825);
        if (scene.setup === 'wall' && team === 1 && index >= 1 && index <= 4) { x = 860; y = 220 + index * 24; }
        if (scene.setup === 'counter' && index !== 0) x = 110 + ((index * 83 + team * 57) % 330);
        if (scene.setup === 'long-pass' && index !== 0) {
          x = 280 + ((index * 93 + team * 75) % 490);
          y = index % 2 ? 205 : 450;
        }
        player(x, y, team);
      });
    }

    function follow(node, path) {
      const frames = path.map(([time, x, y]) => ({ transform: position(x, y), offset: time / scene.duration }));
      const last = path[path.length - 1];
      if (last[0] < scene.duration) frames.push({ transform: position(last[1], last[2]), offset: 1 });
      animate(node, frames, scene.duration);
    }

    for (const move of scene.movers) {
      const [, x, y] = move.path[0];
      const dot = sprite(x, y, colors[move.team], 9, move.team === 1 && move.index === 0 ? 'match-keeper' : 'match-player');
      dot.dataset.player = `${move.team}:${move.index}`;
      follow(dot, move.path);
    }
    const [, x, y] = scene.ball[0];
    follow(sprite(x, y, '#fff', 5, 'match-ball'), scene.ball);

    const last = scene.ball[scene.ball.length - 1];
    const previous = scene.ball[scene.ball.length - 2];
    const trail = document.createElement('div');
    trail.className = 'match-trail';
    sprites.append(trail);
    const line = document.createElement('span');
    Object.assign(line.style, {
      width: `${Math.hypot(last[1] - previous[1], last[2] - previous[2])}px`,
      transform: `translate(${previous[1]}px, ${previous[2]}px) rotate(${Math.atan2(last[2] - previous[2], last[1] - previous[1])}rad)`
    });
    trail.append(line);
    animate(trail, [{ opacity: 0 }, { opacity: .22, offset: .65 }, { opacity: 0 }], last[0] - previous[0] + 350, previous[0]);

    if (scene.goalAt) {
      const ring = document.createElement('span');
      ring.className = 'match-goal-ring';
      sprites.append(ring);
      const atGoal = position(last[1], last[2]);
      animate(ring, [{ transform: atGoal + ' scale(.3)', opacity: 0 }, { transform: atGoal + ' scale(1)', opacity: .35, offset: .3 }, { transform: atGoal + ' scale(1.5)', opacity: 0 }], 700, scene.goalAt);
    }
    updatePlayback();
  }

  resize();
  drawScene();
  hero.classList.add('match-ready');
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
  else window.addEventListener('resize', resize);
  reducedMotion.addEventListener('change', updatePlayback);
  document.addEventListener('visibilitychange', updatePlayback);
  window.addEventListener('pagehide', () => { visible = false; updatePlayback(); });
  window.addEventListener('pageshow', () => { visible = hero.getBoundingClientRect().bottom > 0; updatePlayback(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; updatePlayback(); }).observe(hero);
  }
}
