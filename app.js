/* Étude 2AFC -- comparaison par paires en choix forcé, en une seule passe.
 * Application autonome (aucune dépendance), conçue pour ordinateur ET téléphone.
 * Navigation : un accueil avec trois actions -- faire le tutoriel, scorer, soumettre.
 * La progression est gardée sur l'appareil (localStorage) : on peut fermer la page et reprendre
 * exactement où on en était. Les réponses sont envoyées quand on clique sur « Soumettre ».
 */
(() => {
  "use strict";
  const CFG = window.STUDY_CONFIG;
  const Q = window.QUESTION;
  const params = new URLSearchParams(location.search);
  const app = document.getElementById("app");
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const device = isTouch ? "mobile" : "desktop";

  // ---------- stockage local (toujours protégé : navigation privée, stockage bloqué…) ----------
  const STORE = "human_score_v2";
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  // ---------- participant, liste -------------------------------------------------------------
  const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const randId = () => "anon-" + (crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(36).slice(2, 12));
  const urlPid = params.get("PROLIFIC_PID") || params.get("pid");
  const saved = lsGet(STORE) || {};
  const pid = urlPid || saved.lastPid || randId();
  const nLists = window.TRIAL_LISTS.length;
  const listIdx = params.has("list") ? Math.abs(parseInt(params.get("list"), 10) || 0) % nLists : hashStr(pid) % nLists;
  const LIST = window.TRIAL_LISTS[listIdx].trials;
  const version = hashStr(JSON.stringify(LIST.slice(0, 5)) + LIST.length + JSON.stringify(window.PRACTICE));

  function freshState() {
    return {
      version, list: listIdx, color_vision: "", tutoDone: false, idx: 0, rows: [], sitting: 1,
      submitted: false, started_at: new Date().toISOString(),
      study_id: params.get("STUDY_ID") || "", session_id: params.get("SESSION_ID") || "", source: params.get("src") || "",
    };
  }
  const all = saved.byPid || {};
  let S = all[pid];
  if (!S || S.version !== version || S.list !== listIdx) S = freshState();
  else S.sitting = (S.sitting || 1) + 1;
  const persist = () => { all[pid] = S; lsSet(STORE, { lastPid: pid, byPid: all }); };
  const storageOk = lsSet(STORE + "_probe", 1);
  persist();

  const nTrials = LIST.length;
  const estMin = (n) => Math.max(1, Math.round((n * (isTouch ? 4 : 3.5)) / 60));

  // ---------- utilitaires ---------------------------------------------------------------------
  const stim = (h) => (h.includes("/") ? `${h}.png` : `stim/${h}.png`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const imgCache = new Map();
  function load(src) {
    if (!imgCache.has(src)) {
      imgCache.set(src, new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => res(im);
        im.src = src;
      }));
    }
    return imgCache.get(src);
  }
  const pairSrcs = (trials) => trials.flatMap((t) => [stim(t.left), stim(t.right)]);
  const preload = (trials) => pairSrcs(trials).forEach(load);

  let cleanup = () => {};
  function screen(html, cls = "light") {
    cleanup(); cleanup = () => {};
    app.className = "app " + cls;
    app.innerHTML = html;
    window.scrollTo(0, 0);
    const h = app.querySelector("h1, h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }
  const $ = (sel) => app.querySelector(sel);
  function on(sel, fn) { const el = $(sel); if (el) el.addEventListener("click", fn); return el; }
  const btn = (id, label, cls = "") => `<button type="button" class="btn ${cls}" id="${id}">${label}</button>`;

  // ---------- sauvegarde ----------------------------------------------------------------------
  // Même ordre de colonnes que la version précédente : la feuille Google a déjà cette ligne d'en-tête
  // (le script Apps Script ajoute les lignes telles quelles, sans les aligner sur les noms de colonnes).
  const COLS = ["pid", "list", "device", "block_order", "color_vision", "question", "task", "kind", "trial_in_block",
    "left", "right", "correct", "choice", "chosen", "is_correct", "rt", "layout", "scale", "vw", "vh", "dpr",
    "screen_w", "screen_h", "study_id", "session_id", "source", "started_at", "user_agent"];
  const sessionCols = () => ({
    pid, list: listIdx, device, color_vision: S.color_vision, dpr: devicePixelRatio || 1,
    screen_w: screen_w, screen_h: screen_h, study_id: S.study_id, session_id: S.session_id,
    source: S.source, started_at: S.started_at, user_agent: navigator.userAgent,
  });
  const screen_w = window.screen.width, screen_h = window.screen.height;
  const fullRows = () => S.rows.map((r) => ({ ...sessionCols(), ...r }));
  function toCSV(rs) {
    const q = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [COLS.join(","), ...rs.map((r) => COLS.map((c) => q(r[c])).join(","))].join("\n");
  }
  async function send(rs) {
    if (CFG.DEMO || !CFG.SAVE_URL || !rs.length) return false;
    const body = JSON.stringify({ pid, list: listIdx, part: "final", columns: COLS, rows: rs.map((r) => COLS.map((c) => r[c] ?? "")) });
    for (let i = 0; i < 3; i++) {
      try {
        if (CFG.SAVE_MODE === "apps_script") {
          // Google Apps Script n'accepte pas les requêtes CORS « préflightées » : envoi en text/plain, réponse opaque
          await fetch(CFG.SAVE_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
          return true;
        }
        const r = await fetch(CFG.SAVE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (r.ok) return true;
      } catch (e) { /* nouvel essai */ }
      await wait(1200);
    }
    return false;
  }
  function download(filename, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- écran d'essai -------------------------------------------------------------------
  // Les deux images sont affichées à la même échelle entière en pixels physiques (agrandissement
  // sans lissage), la plus grande qui tienne : côte à côte sur ordinateur, l'une sous l'autre sur téléphone.
  function layoutPair(stage, dims, imgs) {
    const dpr = devicePixelRatio || 1;
    const stacked = stage.clientWidth < stage.clientHeight * 1.1 || stage.clientWidth < 620;
    stage.dataset.layout = stacked ? "stacked" : "side";
    const gap = stacked ? 14 : 40, pad = 8, captionH = isTouch ? 0 : 30;
    const availW = (stacked ? stage.clientWidth : (stage.clientWidth - gap) / 2) - 2 * pad;
    const availH = (stacked ? (stage.clientHeight - gap) / 2 : stage.clientHeight) - 2 * pad - captionH;
    const w = Math.max(...dims.map((d) => d.naturalWidth || 1)), h = Math.max(...dims.map((d) => d.naturalHeight || 1));
    let scale = Math.min((availW * dpr) / w, (availH * dpr) / h);
    scale = scale >= 1 ? Math.floor(scale) : Math.max(0.25, scale);
    imgs.forEach((im, k) => {
      im.style.width = (dims[k].naturalWidth * scale) / dpr + "px";
      im.style.height = (dims[k].naturalHeight * scale) / dpr + "px";
    });
    return { layout: stage.dataset.layout, scale };
  }

  /* Affiche une paire. Résout avec {side, rt, geo} si l'observateur choisit,
   * {action: "home" | "undo"} s'il utilise la barre de navigation. */
  function showPair(t, opts) {
    return new Promise(async (resolve) => {
      const [a, b] = await Promise.all([load(stim(t.left)), load(stim(t.right))]);
      const pct = opts.n ? Math.round((opts.i / opts.n) * 100) : 0;
      screen(`
        <div class="trial-top">
          <div class="nav">
            <button type="button" class="nav-btn" id="home" title="Échap">← Accueil</button>
            <span class="count">${opts.practice ? `Entraînement ${opts.i + 1} / ${opts.n}` : `${opts.i + 1} / ${opts.n}`}</span>
            ${opts.canUndo ? `<button type="button" class="nav-btn" id="undo" title="Retour arrière">↶ Annuler</button>` : `<span class="nav-spacer"></span>`}
          </div>
          <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <p class="q">${isTouch ? window.QUESTION_SHORT : window.QUESTION_TEXT}</p>
        </div>
        <div class="stage" id="stage">
          <button type="button" class="pick" data-side="left" aria-label="Choisir la première image"><img alt="" draggable="false">${isTouch ? "" : '<span class="cap"><kbd>←</kbd></span>'}</button>
          <button type="button" class="pick" data-side="right" aria-label="Choisir la seconde image"><img alt="" draggable="false">${isTouch ? "" : '<span class="cap"><kbd>→</kbd></span>'}</button>
        </div>
        <p class="hint">${isTouch ? "Touchez l'image choisie" : "Cliquez sur l'image choisie, ou flèches ← → du clavier"}</p>`, "trial");
      const stage = $("#stage");
      const els = [...stage.querySelectorAll("img")];
      els[0].src = a.src; els[1].src = b.src;
      let geo = layoutPair(stage, [a, b], els);
      const onResize = () => { geo = layoutPair(stage, [a, b], els); };
      stage.classList.add("ready");
      const t0 = performance.now();
      let done = false;
      const finish = (v) => { if (done) return; done = true; cleanup(); resolve(v); };
      const choose = async (side) => {
        if (done || performance.now() - t0 < 250) return; // ignore les doubles appuis
        stage.querySelector(`[data-side="${side}"]`).classList.add("chosen");
        const rt = Math.round(performance.now() - t0);
        done = true; cleanup();
        await wait(150);
        resolve({ side, rt, geo });
      };
      const onKey = (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); choose("left"); }
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); choose("right"); }
        else if (e.key === "Escape") finish({ action: "home" });
        else if (e.key === "Backspace" && opts.canUndo) { e.preventDefault(); finish({ action: "undo" }); }
      };
      addEventListener("keydown", onKey); addEventListener("resize", onResize);
      cleanup = () => { removeEventListener("keydown", onKey); removeEventListener("resize", onResize); };
      stage.querySelectorAll(".pick").forEach((p) => p.addEventListener("click", () => choose(p.dataset.side)));
      on("#home", () => finish({ action: "home" }));
      on("#undo", () => finish({ action: "undo" }));
    });
  }

  function makeRow(t, res, task, i) {
    const row = {
      question: Q, task, kind: t.kind, trial_in_block: i, left: t.left, right: t.right, correct: t.correct || "",
      choice: res.side, chosen: res.side === "left" ? t.left : t.right, rt: res.rt, layout: res.geo.layout,
      scale: +res.geo.scale.toFixed(3), vw: innerWidth, vh: innerHeight, sitting: S.sitting, answered_at: new Date().toISOString(),
    };
    if (t.correct) row.is_correct = res.side === t.correct;
    return row;
  }

  async function feedback(row) {
    const ok = row.is_correct;
    const where = isTouch ? (row.correct === "left" ? "celle du haut" : "celle du bas") : (row.correct === "left" ? "celle de gauche" : "celle de droite");
    const el = document.createElement("div");
    el.className = "toast " + (ok ? "ok" : "ko");
    el.setAttribute("role", "status");
    el.textContent = ok ? "Bonne réponse" : `La meilleure était ${where}`;
    app.appendChild(el);
    await wait(ok ? 700 : 1700);
  }

  // ---------- accueil -------------------------------------------------------------------------
  const answered = () => S.rows.filter((r) => r.task === "2afc").length;
  const scoringDone = () => S.idx >= nTrials;

  function home() {
    const n = answered();
    const pct = Math.round((S.idx / nTrials) * 100);
    const resumeUrl = `${location.origin}${location.pathname}?pid=${encodeURIComponent(pid)}${params.has("list") ? `&list=${listIdx}` : ""}`;
    const stepCls = (done, active) => `step${done ? " done" : ""}${active ? " active" : ""}`;
    const scoreLabel = S.submitted ? "Terminé" : scoringDone() ? "Terminé" : S.idx > 0 ? `Reprendre (${S.idx} / ${nTrials})` : "Commencer à scorer";
    screen(`
      <main class="sheet">
        <p class="eyebrow">Étude scientifique · ${estMin(nTrials)} min environ, en plusieurs fois si vous voulez</p>
        <h1>Voyez-vous la différence&nbsp;?</h1>
        <p class="lede">Nous développons des méthodes pour corriger les défauts optiques des photos, comme les fines
        franges colorées le long des contours. Comparez des paires d'images et choisissez la meilleure.</p>

        <ol class="steps">
          <li class="${stepCls(S.tutoDone, !S.tutoDone)}">
            <div class="step-head"><span class="num">${S.tutoDone ? "✓" : "1"}</span><div><b>Tutoriel</b><span>Ce qu'il faut regarder, avec quelques essais corrigés · 2 min</span></div></div>
            ${btn("tuto", S.tutoDone ? "Refaire le tutoriel" : "Faire le tutoriel", S.tutoDone ? "secondary" : "")}
          </li>
          <li class="${stepCls(scoringDone(), S.tutoDone && !scoringDone())}">
            <div class="step-head"><span class="num">${scoringDone() ? "✓" : "2"}</span><div><b>Scorer</b><span>${nTrials} comparaisons · ${n ? `${pct} % fait` : "vous pouvez vous arrêter et reprendre à tout moment"}</span></div></div>
            ${S.idx > 0 || S.tutoDone ? `<div class="bar big" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ""}
            ${btn("score", scoreLabel, scoringDone() || !S.tutoDone ? "secondary" : "")}
            ${!S.tutoDone ? `<p class="small">Faites d'abord le tutoriel.</p>` : ""}
          </li>
          <li class="${stepCls(S.submitted, scoringDone() && !S.submitted)}">
            <div class="step-head"><span class="num">${S.submitted ? "✓" : "3"}</span><div><b>Soumettre</b><span>${S.submitted ? "Réponses envoyées, merci !" : scoringDone() ? "Tout est fait : envoyez vos réponses" : `Disponible une fois les ${nTrials} comparaisons faites`}</span></div></div>
            ${btn("submit", S.submitted ? "Voir la confirmation" : "Soumettre mes réponses", S.submitted ? "secondary" : "")}
          </li>
        </ol>

        ${storageOk ? `<p class="note">Votre progression est gardée sur cet appareil : vous pouvez fermer la page et revenir plus tard
          avec le même navigateur.${urlPid ? "" : ` Lien de reprise&nbsp;: <span class="select">${esc(resumeUrl)}</span>`}</p>`
          : `<p class="note">Votre navigateur bloque la sauvegarde locale (navigation privée ?) : la progression sera perdue si vous fermez la page.</p>`}
        <ul class="facts">
          <li><b>Anonyme.</b> Aucune donnée personnelle : seulement vos choix, vos temps de réponse et le type d'écran.</li>
          <li><b>Conseil.</b> Luminosité de l'écran au maximum, pas de mode nuit ni de filtre de lumière bleue.</li>
        </ul>
        ${CFG.DEMO ? `<p class="note">Version de démonstration : rien n'est enregistré.</p>` : ""}
        <div class="footer-links">
          ${CFG.CONTACT ? `<span class="small">Contact : <span class="select">${esc(CFG.CONTACT)}</span></span>` : "<span></span>"}
          ${S.idx > 0 || S.tutoDone ? `<button type="button" class="link" id="reset">Tout recommencer</button>` : ""}
        </div>
      </main>`);
    const sb = $("#score"); if (!S.tutoDone || scoringDone()) sb.disabled = true;
    const sub = $("#submit"); if (!scoringDone()) sub.disabled = true;
    on("#tuto", () => tutorial(0));
    on("#score", scoring);
    on("#submit", () => (S.submitted ? thanks(S.lastSendOk) : submit()));
    on("#reset", () => {
      if (!confirm("Effacer toute votre progression sur cet appareil et recommencer ?")) return;
      S = freshState(); persist(); home();
    });
  }

  // ---------- tutoriel ------------------------------------------------------------------------
  const M0 = (window.TUTO.mires || [])[0];
  const fig = (src, cap, good) => `<figure class="${good ? "good" : ""}"><img src="${src}" alt=""><figcaption>${cap}</figcaption></figure>`;
  const TUTO_PAGES = [
    () => `
      <h1>Le principe</h1>
      <p class="lede">On vous montre <b>deux versions de la même zone</b> d'une photo, traitées par deux méthodes différentes.
      Choisissez <b>la meilleure</b>.</p>
      <p>Les différences sont souvent <b>subtiles</b>. Si les deux images vous semblent identiques, choisissez au mieux : il faut toujours répondre.</p>
      <fieldset class="choices" id="cv">
        <legend>Avez-vous un trouble connu de la vision des couleurs (daltonisme) ?</legend>
        <label><input type="radio" name="cv" value="non"> Non</label>
        <label><input type="radio" name="cv" value="oui"> Oui</label>
        <label><input type="radio" name="cv" value="ne_sait_pas"> Je ne sais pas</label>
      </fieldset>`,
    () => `
      <h1>1. Les franges colorées</h1>
      <p class="lede">Le long des contours contrastés, l'objectif crée de fins <b>liserés violets, bleus, verts ou jaunes</b>.
      C'est le principal défaut à juger : <b>moins on en voit, mieux c'est</b>.</p>
      ${M0 ? `<div class="example zoom">${fig(`tuto/${M0}_bad.png`, "Franges visibles sur les bords")}${fig(`tuto/${M0}_good.png`, "Franges corrigées : à choisir", true)}</div>
      <p class="small">Photo d'une mire, agrandie. Regardez les bords des carrés blancs.</p>` : ""}`,
    () => `
      <h1>2. Sans abîmer l'image</h1>
      <p class="lede">Une bonne correction garde l'image <b>nette et naturelle</b> : pas de flou, pas d'aspect lissé
      ou « plastique », pas de couleurs ou de motifs artificiels.</p>
      ${M0 ? `<div class="example zoom">${fig("tuto/blur_bad.png", "Plus de franges, mais floue")}${fig(`tuto/${M0}_good.png`, "Nette et sans franges : à choisir", true)}</div>` : ""}
      <p>En cas de doute entre franges et netteté, fiez-vous à votre impression d'ensemble : <b>quelle image est la plus réussie&nbsp;?</b></p>`,
    () => `
      <h1>3. Comment répondre</h1>
      <ul class="facts big">
        <li>${isTouch ? "<b>Touchez</b> l'image choisie (l'une est au-dessus de l'autre)." : "<b>Cliquez</b> sur l'image choisie, ou utilisez les flèches <kbd>←</kbd> <kbd>→</kbd>."}</li>
        <li><b>↶ Annuler</b> revient sur la réponse précédente${isTouch ? "" : " (touche <kbd>⌫</kbd>)"}.</li>
        <li><b>← Accueil</b> met en pause${isTouch ? "" : " (touche <kbd>Échap</kbd>)"} : tout est gardé, vous reprendrez au même endroit.</li>
        <li>Une fois toutes les comparaisons faites, cliquez sur <b>Soumettre</b> à l'accueil.</li>
      </ul>
      <p>Pour finir, ${window.PRACTICE.length} essais d'entraînement <b>corrigés</b>.</p>`,
  ];

  function tutorial(page) {
    const last = page === TUTO_PAGES.length - 1;
    screen(`
      <main class="sheet">
        <div class="sheet-nav"><button type="button" class="link" id="home">← Accueil</button><span class="eyebrow">Tutoriel · ${page + 1} / ${TUTO_PAGES.length + 1}</span></div>
        ${TUTO_PAGES[page]()}
        <div class="actions">
          ${page > 0 ? btn("prev", "Précédent", "secondary") : ""}
          ${btn("next", last ? "S'entraîner" : "Suivant")}
        </div>
      </main>`);
    on("#home", home);
    on("#prev", () => tutorial(page - 1));
    const nb = $("#next");
    if (page === 0) {
      if (S.color_vision) { const r = app.querySelector(`input[value="${S.color_vision}"]`); if (r) r.checked = true; }
      nb.disabled = !S.color_vision;
      app.querySelectorAll('input[name="cv"]').forEach((r) => r.addEventListener("change", () => {
        S.color_vision = r.value; persist(); nb.disabled = false;
      }));
    }
    nb.addEventListener("click", () => (last ? practice() : tutorial(page + 1)));
    if (page === 0) preload(window.PRACTICE);
  }

  async function practice() {
    const P = window.PRACTICE;
    // on retire un entraînement précédent éventuel (tutoriel refait)
    S.rows = S.rows.filter((r) => r.task !== "practice");
    for (let i = 0; i < P.length; i++) {
      const res = await showPair(P[i], { practice: true, i, n: P.length, canUndo: false });
      if (res.action === "home") { persist(); return home(); }
      const row = makeRow(P[i], res, "practice", i);
      S.rows.push(row);
      await feedback(row);
    }
    const nOk = S.rows.filter((r) => r.task === "practice" && r.is_correct).length;
    S.tutoDone = true; persist();
    if (!isTouch && document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    screen(`
      <main class="sheet compact">
        <p class="eyebrow">Tutoriel terminé · ${nOk} / ${P.length} bonnes réponses</p>
        <h1>Vous êtes prêt·e</h1>
        <p class="lede">${S.idx > 0 ? `Vous en êtes à ${S.idx} / ${nTrials} comparaisons.` : `${nTrials} comparaisons vous attendent, sans correction cette fois.`}
        Vous pouvez vous arrêter quand vous voulez avec <b>← Accueil</b>.</p>
        <div class="actions">${btn("home", "Accueil", "secondary")}${btn("go", S.idx > 0 ? "Reprendre" : "Commencer à scorer")}</div>
      </main>`);
    on("#home", home);
    on("#go", scoring);
  }

  // ---------- scoring -------------------------------------------------------------------------
  async function scoring() {
    if (!isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen(); } catch (e) { /* refusé : on continue */ }
    }
    let sinceStart = 0;
    while (S.idx < nTrials) {
      const i = S.idx;
      if (sinceStart > 0 && i % window.PAUSE_EVERY === 0) {
        const go = await pause(i);
        if (!go) return leave();
      }
      preload(LIST.slice(i + 1, i + 9));
      const res = await showPair(LIST[i], { practice: false, i, n: nTrials, canUndo: i > 0 });
      if (res.action === "home") return leave();
      if (res.action === "undo") {
        const k = S.rows.map((r) => r.task).lastIndexOf("2afc");
        if (k >= 0) S.rows.splice(k, 1);
        S.idx = Math.max(0, i - 1); persist();
        continue;
      }
      S.rows.push(makeRow(LIST[i], res, "2afc", i));
      S.idx = i + 1; sinceStart++;
      persist();
    }
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    screen(`
      <main class="sheet compact">
        <p class="eyebrow">${nTrials} / ${nTrials}</p>
        <h1>C'est fini&nbsp;!</h1>
        <p class="lede">Il ne reste plus qu'à envoyer vos réponses.</p>
        <div class="actions">${btn("home", "Accueil", "secondary")}${btn("submit", "Soumettre mes réponses")}</div>
      </main>`);
    on("#home", home);
    on("#submit", submit);
  }

  async function leave() {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    home();
  }

  function pause(i) {
    return new Promise((res) => {
      screen(`<main class="sheet compact"><p class="eyebrow">Pause · ${i} / ${nTrials}</p><h1>Reposez vos yeux</h1>
        <p class="lede">Reprenez quand vous voulez, maintenant ou plus tard.</p>
        <div class="actions">${btn("home", "Accueil", "secondary")}${btn("go", "Reprendre")}</div></main>`);
      on("#home", () => res(false));
      on("#go", () => res(true));
    });
  }

  // ---------- soumission ----------------------------------------------------------------------
  async function submit() {
    screen(`<main class="sheet compact"><p class="eyebrow">Envoi</p><h1>Envoi de vos réponses…</h1>
      <div class="bar big indeterminate" aria-hidden="true"><i></i></div></main>`);
    const ok = await send(fullRows());
    S.submitted = true; S.lastSendOk = ok || CFG.DEMO; persist();
    thanks(S.lastSendOk);
  }

  function thanks(ok) {
    const shareUrl = location.origin + location.pathname;
    const noServer = !CFG.DEMO && !CFG.SAVE_URL;
    screen(`
      <main class="sheet">
        <p class="eyebrow">Terminé · ${answered()} comparaisons</p>
        <h1>Merci&nbsp;!</h1>
        <p class="lede">${CFG.DEMO ? "C'était la version de démonstration : vos réponses n'ont pas été enregistrées."
          : ok ? "Vos réponses ont bien été envoyées. Elles nous aideront à évaluer nos méthodes de correction d'images."
          : noServer ? "Téléchargez vos réponses et transmettez le fichier au responsable de l'étude."
          : "L'envoi automatique a échoué. Réessayez, ou téléchargez vos réponses et transmettez le fichier au responsable de l'étude."}</p>
        <div class="actions">
          ${!ok && !noServer && !CFG.DEMO ? btn("retry", "Réessayer l'envoi") : ""}
          ${!CFG.DEMO ? btn("dl", "Télécharger mes réponses", "secondary") : ""}
        </div>
        <div class="share">
          <p>Plus il y a de participants, plus les résultats sont fiables. Partagez l'étude&nbsp;:</p>
          <div class="copy"><span class="select" id="url">${esc(shareUrl)}</span><button type="button" class="btn small-btn" id="copy">Copier le lien</button></div>
        </div>
        <div class="actions">
          ${btn("home", "Accueil", "secondary")}
          ${CFG.COMPLETION_URL ? `<a class="btn" href="${esc(CFG.COMPLETION_URL)}">Terminer l'étude</a>` : ""}
        </div>
      </main>`);
    on("#retry", submit);
    on("#home", home);
    on("#dl", () => download(`responses_${pid}_list${listIdx}.csv`, toCSV(fullRows())));
    on("#copy", async (e) => {
      try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = "Lien copié"; }
      catch (err) { const r = document.createRange(); r.selectNodeContents($("#url")); getSelection().removeAllRanges(); getSelection().addRange(r); }
    });
  }

  if (M0) { load(`tuto/${M0}_bad.png`); load(`tuto/${M0}_good.png`); }
  home();
})();
