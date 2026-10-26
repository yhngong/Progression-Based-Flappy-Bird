(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const $ = (selector) => document.querySelector(selector);
  const screens = [$("#menu-screen"), $("#skill-screen"), $("#gameover-screen")];
  const storageKey = "riftbird-save-v1";
  const world = { width: 960, height: 600 };
  const bird = { x: 220, y: 300, velocity: 0, radius: 16, gravity: 1, rotation: 0 };
  const pipeWidth = 76;
  const skills = [
    { id: "feather", name: "Point Pouch", icon: "✧", description: "Earn +1 point per gate per rank.", costs: [2, 4, 6], requires: null },
    { id: "wings", name: "Streak Bonus", icon: "↟", description: "Bonus points every 5 gates.", costs: [2, 4, 6], requires: ["feather", 1] },
    { id: "portal", name: "Rift Reader", icon: "◉", description: "Earn bonus points at rifts.", costs: [3, 5, 7], requires: ["feather", 1] },
    { id: "secondWind", name: "Second Wind", icon: "♡", description: "Survive one crash per run.", costs: [8], requires: ["wings", 2] },
    { id: "multiplier", name: "Score Surge", icon: "✦", description: "Earn double points.", costs: [8], requires: ["portal", 2] },
    { id: "stability", name: "Gate Scout", icon: "⌁", description: "Highlights safe gate openings.", costs: [4, 7], requires: ["wings", 1] },
    { id: "speed", name: "Skill Savant", icon: "◷", description: "Earn a bonus skill point every 5 gates.", costs: [3, 5, 8], requires: ["stability", 1] }
  ];
  const skins = [
    { id: "classic", name: "Sunbeam", description: "The original golden bird.", cost: 0, body: "#f6d487", belly: "#fff0bb", wing: "#a77bff", beak: "#f28d89" },
    { id: "ocean", name: "Deep Current", description: "A cool ocean-blue look.", cost: 8, body: "#56c8d8", belly: "#c4f5f3", wing: "#347eae", beak: "#f3bd72" },
    { id: "cinder", name: "Cinderwing", description: "A warm ember-colored bird.", cost: 12, body: "#ff9866", belly: "#ffe0a3", wing: "#c34a5a", beak: "#ffe17b" },
    { id: "meadow", name: "Meadow", description: "Fresh green with sunny details.", cost: 16, body: "#8bd17c", belly: "#edffc0", wing: "#478b78", beak: "#f6ad68" },
    { id: "cosmic", name: "Cosmic", description: "A little bird from another rift.", cost: 22, body: "#bd91ff", belly: "#f2d8ff", wing: "#6359c9", beak: "#77e6e6" }
  ];
  const deathEffects = [
    { id: "starburst", name: "Starburst", description: "A bright burst of stardust.", cost: 0, colors: ["#91e8ff", "#d0a5ff", "#ffd783"], shape: "circle", count: 34, speed: [1, 4] },
    { id: "embers", name: "Embers", description: "A shower of glowing embers.", cost: 10, colors: ["#ff684a", "#ffb347", "#ffe29a"], shape: "circle", count: 44, speed: [0.8, 3.8] },
    { id: "confetti", name: "Confetti", description: "A colorful celebratory pop.", cost: 15, colors: ["#ff6584", "#ffd166", "#68e0cf", "#a58aff"], shape: "square", count: 58, speed: [1, 4.5] },
    { id: "nova", name: "Nova", description: "A cool, radiant rift flash.", cost: 20, colors: ["#66e6ef", "#bd8dff", "#ffffff"], shape: "ring", count: 40, speed: [1.5, 5] }
  ];
  const skillLayout = {
    feather: { x: 166, y: 246 },
    wings: { x: 435, y: 132 },
    portal: { x: 435, y: 326 },
    secondWind: { x: 716, y: 54 },
    stability: { x: 716, y: 148 },
    multiplier: { x: 716, y: 326 },
    speed: { x: 824, y: 148 }
  };
  const treeMapSize = { width: 1000, height: 420 };

  const defaults = {
    points: 0,
    best: 0,
    upgrades: {},
    cosmetics: {
      ownedSkins: ["classic"],
      ownedEffects: ["starburst"],
      skin: "classic",
      effect: "starburst"
    }
  };
  let save = loadSave();
  let pipes = [];
  let pipesSpawned = 0;
  let stars = [];
  let particles = [];
  let score = 0;
  let pipesPassed = 0;
  let frame = 0;
  let state = "menu";
  let invulnerable = 0;
  let rescued = false;
  let soundEnabled = false;
  let audioContext = null;
  let toastTimer;

  function loadSave() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return structuredClone(defaults);
    try {
      const data = JSON.parse(raw);
      const upgrades = {};
      for (const skill of skills) {
        const rank = Number(data.upgrades?.[skill.id]) || 0;
        upgrades[skill.id] = Math.max(0, Math.min(skill.costs.length, rank));
      }
      return {
        points: Math.max(0, Number(data.points) || 0),
        best: Math.max(0, Number(data.best) || 0),
        upgrades,
        cosmetics: loadCosmetics(data.cosmetics)
      };
    } catch (error) {
      console.error("Could not read the saved flight plan.", error);
      return structuredClone(defaults);
    }
  }

  function loadCosmetics(data = {}) {
    const ownedSkins = new Set(["classic"]);
    const ownedEffects = new Set(["starburst"]);
    for (const id of data.ownedSkins || []) {
      if (skins.some((skin) => skin.id === id)) ownedSkins.add(id);
    }
    for (const id of data.ownedEffects || []) {
      if (deathEffects.some((effect) => effect.id === id)) ownedEffects.add(id);
    }
    return {
      ownedSkins: [...ownedSkins],
      ownedEffects: [...ownedEffects],
      skin: ownedSkins.has(data.skin) ? data.skin : "classic",
      effect: ownedEffects.has(data.effect) ? data.effect : "starburst"
    };
  }

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(save));
  }

  function rankOf(id) {
    return save.upgrades[id] || 0;
  }

  function showScreen(screen) {
    screens.forEach((item) => { item.hidden = item !== screen; });
    $("#hud").hidden = screen !== null;
  }

  function refreshMenu() {
    $("#best-score").textContent = save.best;
    $("#banked-points").textContent = save.points;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const scale = Math.min(canvas.width / world.width, canvas.height / world.height);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - world.width * scale) / 2, (canvas.height - world.height * scale) / 2);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function newRun() {
    score = 0;
    pipesPassed = 0;
    frame = 0;
    pipes = [];
    pipesSpawned = 0;
    particles = [];
    bird.y = world.height / 2;
    bird.velocity = 0;
    bird.gravity = 1;
    bird.rotation = 0;
    invulnerable = 0;
    rescued = false;
    state = "playing";
    spawnPipe();
    $("#score").textContent = "0";
    updateGravityTag();
    showScreen(null);
    flap();
  }

  function spawnPipe() {
    pipesSpawned++;
    const gapSize = Math.max(145, 194 - score * 2);
    const margin = 86 + gapSize / 2;
    const gapCenter = randomBetween(margin, world.height - margin);
    pipes.push({
      x: world.width + 24,
      hasRift: pipesSpawned % 5 === 0,
      gapTop: gapCenter - gapSize / 2,
      gapBottom: gapCenter + gapSize / 2,
      gapCenter,
      scored: false,
      flipped: false
    });
  }

  function flap() {
    if (state !== "playing") return;
    bird.velocity = -bird.gravity * 7.2;
    burst(bird.x - bird.gravity * 12, bird.y, bird.gravity === 1 ? "#91e8ff" : "#d0a5ff", 5);
    playTone(460, 0.045, "sine");
  }

  function updateGravityTag() {
    const tag = $("#gravity-tag");
    tag.textContent = bird.gravity === 1 ? "↓ GRAVITY" : "↑ GRAVITY";
    tag.classList.toggle("up", bird.gravity === -1);
  }

  function gameOver() {
    if (state !== "playing") return;
    state = "gameover";
    playDeathEffect();
    const bonusSkillPoints = Math.floor(pipesPassed / 5) * rankOf("speed");
    const earnedPoints = score + bonusSkillPoints;
    save.points += earnedPoints;
    save.best = Math.max(save.best, score);
    persist();
    $("#final-score").textContent = score;
    $("#final-best").textContent = save.best;
    $("#earned-points").textContent = earnedPoints;
    refreshMenu();
    playTone(130, 0.25, "triangle");
    showScreen($("#gameover-screen"));
  }

  function handleCollision(pipe) {
    if (invulnerable > 0) return false;
    if (rankOf("secondWind") > 0 && !rescued) {
      rescued = true;
      invulnerable = 95;
      bird.y = Math.max(pipe.gapTop + bird.radius + 3, Math.min(pipe.gapBottom - bird.radius - 3, bird.y));
      bird.velocity = -bird.gravity * 5;
      pipe.x = bird.x - pipeWidth - 2;
      pipe.scored = true;
      burst(bird.x, bird.y, "#ffd783", 24);
      showToast("SECOND WIND!");
      playTone(690, 0.15, "triangle");
      return true;
    }
    gameOver();
    return true;
  }

  function update() {
    if (state !== "playing") {
      if (state === "gameover") updateParticles();
      return;
    }
    frame++;
    const gravityPower = 0.37;
    const speed = 3.2 + Math.min(score * 0.06, 1.5);
    bird.velocity += gravityPower * bird.gravity;
    bird.y += bird.velocity;
    bird.rotation = Math.max(-0.55, Math.min(0.9, bird.velocity * 0.075));
    if (invulnerable > 0) invulnerable--;

    if (pipes[pipes.length - 1].x < world.width - 430) spawnPipe();
    for (const pipe of pipes) {
      pipe.x -= speed;
      if (pipe.hasRift && !pipe.flipped && pipe.x + 39 < bird.x + bird.radius + 11) {
        pipe.flipped = true;
        bird.gravity *= -1;
        bird.velocity = bird.gravity * -5.5;
        updateGravityTag();
        burst(bird.x, bird.y, "#bd8dff", 17);
        showToast("GRAVITY FLIPPED");
        playTone(740, 0.12, "sine");
      }
      if (!pipe.scored && pipe.x + pipeWidth < bird.x) {
        pipe.scored = true;
        pipesPassed++;
        const gatePoints = 1 + rankOf("feather") + (pipesPassed % 5 === 0 ? rankOf("wings") : 0);
        const riftPoints = pipe.hasRift ? rankOf("portal") * 2 : 0;
        score += gatePoints * (rankOf("multiplier") > 0 ? 2 : 1) + riftPoints;
        $("#score").textContent = score;
        burst(bird.x, bird.y, "#ffd783", 10);
        playTone(800, 0.06, "sine");
      }
      const overlapsBird = pipe.x < bird.x + bird.radius - 2 && pipe.x + pipeWidth > bird.x - bird.radius + 2;
      if (overlapsBird && (bird.y - bird.radius < pipe.gapTop || bird.y + bird.radius > pipe.gapBottom)) {
        if (handleCollision(pipe)) break;
      }
    }
    pipes = pipes.filter((pipe) => pipe.x + pipeWidth > -20);

    if (bird.y - bird.radius < 0 || bird.y + bird.radius > world.height) {
      if (rankOf("secondWind") > 0 && !rescued) {
        rescued = true;
        invulnerable = 95;
        bird.y = bird.y < world.height / 2 ? bird.radius + 3 : world.height - bird.radius - 3;
        bird.velocity = -bird.gravity * 5;
        burst(bird.x, bird.y, "#ffd783", 24);
        showToast("SECOND WIND!");
      } else {
        gameOver();
      }
    }
    updateParticles();
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, world.width, world.height);
    gradient.addColorStop(0, "#11162d");
    gradient.addColorStop(0.55, "#11132b");
    gradient.addColorStop(1, "#20153b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, world.width, world.height);
    const glow = ctx.createRadialGradient(740, 180, 5, 740, 180, 390);
    glow.addColorStop(0, "rgba(104, 72, 179, .25)");
    glow.addColorStop(1, "rgba(104, 72, 179, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, world.width, world.height);

    for (let i = 0; i < 65; i++) {
      const x = (i * 197 + 53) % world.width;
      const y = (i * 113 + 31) % world.height;
      const twinkle = 0.25 + (Math.sin(frame * 0.035 + i) + 1) * 0.23;
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = i % 8 === 0 ? "#b7a7ff" : "#c8d9ff";
      ctx.fillRect(x, y, i % 8 === 0 ? 2 : 1.5, i % 8 === 0 ? 2 : 1.5);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(159, 171, 233, .055)";
    ctx.lineWidth = 1;
    for (let x = 0; x < world.width; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, world.height); ctx.stroke();
    }
    for (let y = 0; y < world.height; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(world.width, y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(10, 13, 29, .45)";
    ctx.fillRect(0, world.height - 16, world.width, 16);
    ctx.fillStyle = "rgba(102, 230, 239, .28)";
    ctx.fillRect(0, world.height - 16, world.width, 1);
  }

  function drawPipe(pipe) {
    const topHeight = pipe.gapTop;
    const bottomY = pipe.gapBottom;
    const gradient = ctx.createLinearGradient(pipe.x, 0, pipe.x + pipeWidth, 0);
    gradient.addColorStop(0, "#30305c");
    gradient.addColorStop(0.5, "#414479");
    gradient.addColorStop(1, "#24284d");
    ctx.fillStyle = gradient;
    ctx.fillRect(pipe.x, 0, pipeWidth, topHeight);
    ctx.fillRect(pipe.x, bottomY, pipeWidth, world.height - bottomY);
    ctx.fillStyle = "rgba(167, 123, 255, .36)";
    ctx.fillRect(pipe.x, topHeight - 8, pipeWidth, 8);
    ctx.fillRect(pipe.x, bottomY, pipeWidth, 8);
    ctx.fillStyle = "rgba(176, 183, 255, .2)";
    ctx.fillRect(pipe.x + 7, 0, 2, topHeight - 8);
    ctx.fillRect(pipe.x + 7, bottomY + 8, 2, world.height - bottomY - 8);
    if (rankOf("stability") > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 220, 133, .75)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#f2ce79";
      ctx.shadowBlur = 8;
      ctx.strokeRect(pipe.x - 3, topHeight + 2, pipeWidth + 6, bottomY - topHeight - 4);
      ctx.restore();
    }

    if (!pipe.hasRift) return;
    const portalX = pipe.x + 39;
    const portalY = pipe.gapCenter;
    ctx.save();
    ctx.shadowColor = "#bd8dff";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = pipe.flipped ? "rgba(102, 230, 239, .65)" : "#bd8dff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(portalX, portalY, 13, 39, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(197, 157, 255, .55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(portalX, portalY, 7, 28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(191, 143, 255, .15)";
    ctx.beginPath();
    ctx.ellipse(portalX, portalY, 10, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBird() {
    const skin = skins.find((item) => item.id === save.cosmetics.skin) || skins[0];
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);
    if (invulnerable > 0 && Math.floor(invulnerable / 6) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.shadowColor = bird.gravity === 1 ? "#67e8f2" : "#be8aff";
    ctx.shadowBlur = 17;
    ctx.fillStyle = skin.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = skin.belly;
    ctx.beginPath();
    ctx.ellipse(-4, -4, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin.wing;
    ctx.beginPath();
    ctx.ellipse(-9, 2 + Math.sin(frame * 0.25) * 2, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin.beak;
    ctx.beginPath();
    ctx.moveTo(17, -2); ctx.lineTo(28, 1); ctx.lineTo(17, 5); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(7, -6, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#20233e";
    ctx.beginPath(); ctx.arc(8, -6, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      if (particle.shape === "square") {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.fillRect(-particle.size, -particle.size, particle.size * 2, particle.size * 2);
        ctx.restore();
      } else if (particle.shape === "ring") {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 2, 0, Math.PI * 2);
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0c1021";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / world.width, canvas.height / world.height);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - world.width * scale) / 2, (canvas.height - world.height * scale) / 2);
    drawBackground();
    pipes.forEach(drawPipe);
    drawParticles();
    if (state !== "gameover") drawBird();
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(0.8, 3.8);
      particles.push({
        x, y, color, size: randomBetween(1.5, 3.5), life: randomBetween(16, 34), maxLife: 34, shape: "circle",
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed
      });
    }
  }

  function playDeathEffect() {
    const effect = deathEffects.find((item) => item.id === save.cosmetics.effect) || deathEffects[0];
    for (let i = 0; i < effect.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(effect.speed[0], effect.speed[1]);
      const life = randomBetween(25, 58);
      particles.push({
        x: bird.x,
        y: bird.y,
        color: effect.colors[i % effect.colors.length],
        size: randomBetween(2, effect.id === "nova" ? 6 : 4),
        life,
        maxLife: life,
        shape: effect.shape,
        rotation: randomBetween(0, Math.PI),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed
      });
    }
  }

  function updateParticles() {
    particles = particles.filter((particle) => particle.life > 0);
    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life--;
    }
  }

  function showToast(text) {
    const toast = $("#toast");
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 850);
  }

  function playTone(frequency, duration, type) {
    if (!soundEnabled) return;
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.045, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function drawSkillTree() {
    const map = $("#tree-grid");
    map.replaceChildren();
    $("#tree-points").textContent = save.points;
    const connectors = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectors.setAttribute("class", "tree-connectors");
    connectors.setAttribute("aria-hidden", "true");
    connectors.setAttribute("viewBox", `0 0 ${treeMapSize.width} ${treeMapSize.height}`);
    connectors.setAttribute("preserveAspectRatio", "none");
    map.append(connectors);
    const nodePositions = new Map();
    const skillLabels = document.createElement("div");
    skillLabels.className = "tree-labels";
    map.append(skillLabels);

    for (const skill of skills) {
      const rank = rankOf(skill.id);
      const requirementMet = !skill.requires || rankOf(skill.requires[0]) >= skill.requires[1];
      const layout = skillLayout[skill.id];
      const lastX = layout.x + (skill.costs.length - 1) * 62;
      const label = document.createElement("span");
      label.className = "tree-skill-label";
      label.textContent = skill.name.toUpperCase();
      label.style.left = `${((layout.x + lastX) / 2) / treeMapSize.width * 100}%`;
      label.style.top = `${(layout.y - 43) / treeMapSize.height * 100}%`;
      skillLabels.append(label);

      for (let index = 0; index < skill.costs.length; index++) {
        const x = layout.x + index * 62;
        const purchased = rank > index;
        const available = requirementMet && rank === index;
        const canBuy = available && save.points >= skill.costs[index];
        const node = document.createElement("button");
        node.type = "button";
        node.className = `tree-node${purchased ? " purchased" : ""}${available ? " available" : ""}${!requirementMet ? " locked" : ""}`;
        node.style.left = `${x / treeMapSize.width * 100}%`;
        node.style.top = `${layout.y / treeMapSize.height * 100}%`;
        node.disabled = !canBuy;
        node.setAttribute("aria-label", `${skill.name}, rank ${index + 1}, ${purchased ? "unlocked" : available ? `cost ${skill.costs[index]} skill points` : "locked"}`);
        node.title = `${skill.name} ${index + 1}/${skill.costs.length}: ${skill.description} · ${purchased ? "Unlocked" : available ? `${skill.costs[index]} skill points` : "Locked"}`;
        node.innerHTML = `
          <span class="tree-node-icon">${skill.icon}</span>
          <span class="tree-node-rank">${index + 1}</span>
          ${purchased ? "" : `<span class="tree-node-cost">${available ? `✦${skill.costs[index]}` : "⌑"}</span>`}`;
        if (canBuy) node.addEventListener("click", () => buySkill(skill, index));
        map.append(node);
        nodePositions.set(`${skill.id}:${index}`, { x, y: layout.y, purchased });

        if (index > 0) {
          const previous = nodePositions.get(`${skill.id}:${index - 1}`);
          drawTreeEdge(connectors, previous, { x, y: layout.y }, previous.purchased);
        }
      }
    }

    for (const skill of skills) {
      if (!skill.requires) continue;
      const parent = nodePositions.get(`${skill.requires[0]}:${skill.requires[1] - 1}`);
      const child = nodePositions.get(`${skill.id}:0`);
      drawTreeEdge(connectors, parent, child, rankOf(skill.requires[0]) >= skill.requires[1]);
    }
  }

  function drawCosmeticsShop() {
    $("#tree-points").textContent = save.points;
    const container = $("#cosmetics-grid");
    container.replaceChildren();
    const sections = [
      { title: "BIRD SKINS", items: skins, owned: save.cosmetics.ownedSkins, selected: save.cosmetics.skin, type: "skin" },
      { title: "FLIGHT-ENDING EFFECTS", items: deathEffects, owned: save.cosmetics.ownedEffects, selected: save.cosmetics.effect, type: "effect" }
    ];
    for (const section of sections) {
      const heading = document.createElement("h3");
      heading.className = "cosmetic-section-title";
      heading.textContent = section.title;
      container.append(heading);
      const list = document.createElement("div");
      list.className = "cosmetic-list";
      for (const item of section.items) {
        const owned = section.owned.includes(item.id);
        const selected = section.selected === item.id;
        const card = document.createElement("article");
        card.className = `cosmetic-card${selected ? " selected" : ""}`;
        const preview = section.type === "skin"
          ? `<span class="skin-preview" style="--skin-body:${item.body};--skin-belly:${item.belly};--skin-wing:${item.wing};--skin-beak:${item.beak}"><i></i></span>`
          : `<span class="effect-preview ${item.id}">${item.shape === "square" ? "▪ ✦ ▪" : item.shape === "ring" ? "◎ ✧ ◎" : "✦ · ✧"}</span>`;
        const buttonText = selected ? "EQUIPPED" : owned ? "EQUIP" : `BUY · ✦ ${item.cost}`;
        const canAct = selected || owned || save.points >= item.cost;
        card.innerHTML = `
          <div class="cosmetic-preview">${preview}</div>
          <div class="cosmetic-info"><h4>${item.name}</h4><p>${item.description}</p></div>
          <button class="cosmetic-button" ${canAct ? "" : "disabled"}>${buttonText}</button>`;
        card.querySelector("button").addEventListener("click", () => {
          if (selected) return;
          if (owned) {
            equipCosmetic(section.type, item.id);
          } else if (save.points >= item.cost) {
            save.points -= item.cost;
            section.owned.push(item.id);
            equipCosmetic(section.type, item.id);
          }
        });
        list.append(card);
      }
      container.append(list);
    }
  }

  function equipCosmetic(type, id) {
    if (type === "skin") save.cosmetics.skin = id;
    else save.cosmetics.effect = id;
    persist();
    refreshMenu();
    drawCosmeticsShop();
    playTone(600, 0.1, "sine");
  }

  function drawTreeEdge(svg, from, to, unlocked) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startX = from.x + 25;
    const endX = to.x - 25;
    const middleX = startX + Math.max(8, (endX - startX) / 2);
    path.setAttribute("d", `M ${startX} ${from.y} H ${middleX} V ${to.y} H ${endX}`);
    path.setAttribute("class", `tree-edge${unlocked ? " available" : ""}`);
    svg.append(path);
  }

  function buySkill(skill, requestedRank = rankOf(skill.id)) {
    const rank = rankOf(skill.id);
    if (requestedRank !== rank) return;
    const cost = skill.costs[rank];
    const requirementMet = !skill.requires || rankOf(skill.requires[0]) >= skill.requires[1];
    if (!requirementMet || cost === undefined || save.points < cost) return;
    save.points -= cost;
    save.upgrades[skill.id] = rank + 1;
    persist();
    drawSkillTree();
    refreshMenu();
    playTone(600, 0.1, "sine");
  }

  function animationLoop() {
    update();
    render();
    requestAnimationFrame(animationLoop);
  }

  function showTreeTab() {
    $("#tree-view").hidden = false;
    $("#cosmetics-view").hidden = true;
    $("#tree-tab").setAttribute("aria-selected", "true");
    $("#cosmetics-tab").setAttribute("aria-selected", "false");
    drawSkillTree();
  }

  $("#play-button").addEventListener("click", newRun);
  $("#retry-button").addEventListener("click", newRun);
  $("#tree-button").addEventListener("click", () => { showTreeTab(); showScreen($("#skill-screen")); });
  $("#gameover-tree-button").addEventListener("click", () => { showTreeTab(); showScreen($("#skill-screen")); });
  $("#tree-tab").addEventListener("click", showTreeTab);
  $("#cosmetics-tab").addEventListener("click", () => {
    $("#tree-view").hidden = true;
    $("#cosmetics-view").hidden = false;
    $("#tree-tab").setAttribute("aria-selected", "false");
    $("#cosmetics-tab").setAttribute("aria-selected", "true");
    drawCosmeticsShop();
  });
  $("#tree-close").addEventListener("click", () => {
    refreshMenu();
    showScreen(state === "gameover" ? $("#gameover-screen") : $("#menu-screen"));
  });
  $("#quit-button").addEventListener("click", () => {
    state = "menu";
    bird.y = world.height / 2;
    refreshMenu();
    showScreen($("#menu-screen"));
  });
  $("#sound-button").addEventListener("click", async (event) => {
    soundEnabled = !soundEnabled;
    event.currentTarget.classList.toggle("muted", !soundEnabled);
    event.currentTarget.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
    if (soundEnabled) {
      audioContext ||= new AudioContext();
      await audioContext.resume();
      playTone(520, 0.08, "sine");
    }
  });
  canvas.addEventListener("pointerdown", () => {
    if (state === "playing") flap();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      if (state === "playing") flap();
      else if (state === "menu") newRun();
    }
  });
  window.addEventListener("resize", resize);

  resize();
  refreshMenu();
  animationLoop();
})();
