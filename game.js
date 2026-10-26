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
    { id: "feather", name: "Featherweight", icon: "✧", description: "Gravity is gentler.", costs: [2, 4, 6], requires: null },
    { id: "wings", name: "Stronger Wings", icon: "↟", description: "Flaps give you more lift.", costs: [2, 4, 6], requires: ["feather", 1] },
    { id: "portal", name: "Rift Reader", icon: "◉", description: "Gates are worth extra points.", costs: [3, 5, 7], requires: ["feather", 1] },
    { id: "secondWind", name: "Second Wind", icon: "♡", description: "Survive one crash per run.", costs: [8], requires: ["wings", 2] },
    { id: "multiplier", name: "Score Surge", icon: "✦", description: "Earn double points.", costs: [8], requires: ["portal", 2] },
    { id: "stability", name: "Steady Flight", icon: "⌁", description: "Slower, easier-to-read gates.", costs: [4, 7], requires: ["wings", 1] },
    { id: "speed", name: "Quick Current", icon: "➤", description: "Pipes move faster.", costs: [3, 5, 8], requires: ["wings", 1] }
  ];

  const defaults = { points: 0, best: 0, upgrades: {} };
  let save = loadSave();
  let pipes = [];
  let pipesSpawned = 0;
  let stars = [];
  let particles = [];
  let score = 0;
  let frame = 0;
  let state = "menu";
  let invulnerable = 0;
  let rescued = false;
  let soundEnabled = false;
  let audioContext = null;
  let toastTimer;

  function loadSave() {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaults, upgrades: {} };
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
        upgrades
      };
    } catch (error) {
      console.error("Could not read the saved flight plan.", error);
      return { ...defaults, upgrades: {} };
    }
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
    const wingBoost = 1 + rankOf("wings") * 0.08;
    bird.velocity = -bird.gravity * 7.2 * wingBoost;
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
    save.points += score;
    save.best = Math.max(save.best, score);
    persist();
    $("#final-score").textContent = score;
    $("#final-best").textContent = save.best;
    $("#earned-points").textContent = score;
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
    if (state !== "playing") return;
    frame++;
    const gravityPower = 0.37 * (1 - rankOf("feather") * 0.07);
    const speed = (3.2 + Math.min(score * 0.06, 1.5)) *
      (rankOf("stability") > 0 ? 0.9 : 1) *
      (1 + rankOf("speed") * 0.1);
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
        score += (rankOf("multiplier") > 0 ? 2 : 1) + rankOf("portal");
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
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);
    if (invulnerable > 0 && Math.floor(invulnerable / 6) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.shadowColor = bird.gravity === 1 ? "#67e8f2" : "#be8aff";
    ctx.shadowBlur = 17;
    ctx.fillStyle = "#f6d487";
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff0bb";
    ctx.beginPath();
    ctx.ellipse(-4, -4, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a77bff";
    ctx.beginPath();
    ctx.ellipse(-9, 2 + Math.sin(frame * 0.25) * 2, 10, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f28d89";
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
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
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
        x, y, color, size: randomBetween(1.5, 3.5), life: randomBetween(16, 34), maxLife: 34,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed
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
    const grid = $("#tree-grid");
    grid.replaceChildren();
    $("#tree-points").textContent = save.points;
    for (const skill of skills) {
      const rank = rankOf(skill.id);
      const requirementMet = !skill.requires || rankOf(skill.requires[0]) >= skill.requires[1];
      const maxed = rank >= skill.costs.length;
      const cost = skill.costs[rank];
      const canBuy = requirementMet && !maxed && save.points >= cost;
      const card = document.createElement("article");
      card.className = `skill-card${!requirementMet ? " locked" : ""}${rank > 0 ? " unlocked" : ""}${maxed ? " maxed" : ""}`;
      const lockText = skill.requires && !requirementMet ? `Needs ${skills.find((item) => item.id === skill.requires[0]).name} ${skill.requires[1]}` : skill.description;
      card.innerHTML = `
        <div class="skill-card-top"><span class="skill-icon">${skill.icon}</span><span class="skill-rank">${rank}/${skill.costs.length}</span></div>
        <h3>${skill.name}</h3><p>${lockText}</p>
        <button class="skill-buy" ${canBuy ? "" : "disabled"}>${maxed ? "MAXED" : requirementMet ? `UNLOCK · ✦ ${cost}` : "LOCKED"}</button>`;
      const button = card.querySelector("button");
      if (canBuy) button.addEventListener("click", () => buySkill(skill));
      grid.append(card);
    }
  }

  function buySkill(skill) {
    const rank = rankOf(skill.id);
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

  $("#play-button").addEventListener("click", newRun);
  $("#retry-button").addEventListener("click", newRun);
  $("#tree-button").addEventListener("click", () => { drawSkillTree(); showScreen($("#skill-screen")); });
  $("#gameover-tree-button").addEventListener("click", () => { drawSkillTree(); showScreen($("#skill-screen")); });
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
