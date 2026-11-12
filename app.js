/* Étude 2AFC -- comparaison par paires en choix forcé.
 * Application autonome (aucune dépendance), conçue pour ordinateur ET téléphone.
 * Déroulé : accueil/consentement -> questions préalables -> pour chaque question :
 * consigne illustrée, entraînement avec correction, essais (pauses régulières) -> fin.
 * Les réponses sont envoyées à la fin de chaque partie (SAVE_URL), ou téléchargeables.
 */
(() => {
  "use strict";
  const CFG = window.STUDY_CONFIG;
  const QUESTIONS = window.QUESTIONS;
  const SHORT = window.QUESTIONS_SHORT || {};
  const params = new URLSearchParams(location.search);
  const app = document.getElementById("app");

  // ---------- participant, liste, appareil ---------------------------------------------------
  const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const pid = params.get("PROLIFIC_PID") || params.get("pid") ||
    "anon-" + (crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(36).slice(2, 12));
  const nLists = window.TRIAL_LISTS.length;
  const listIdx = params.has("list") ? Math.abs(parseInt(params.get("list"), 10) || 0) % nLists : hashStr(pid) % nLists;
  const LIST = window.TRIAL_LISTS[listIdx];
  const qNames = Object.keys(QUESTIONS);
  const blockOrder = hashStr(pid + "order") % 2 === 0 ? qNames : [...qNames].reverse();
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const device = isTouch ? "mobile" : "desktop";

  const session = {
    pid, list: listIdx, device, block_order: blockOrder.join(">"),
    study_id: params.get("STUDY_ID") || "", session_id: params.get("SESSION_ID") || "",
    source: params.get("src") || "", dpr: devicePixelRatio || 1,
    screen_w: screen.width, screen_h: screen.height, user_agent: navigator.userAgent,
    color_vision: "", started_at: new Date().toISOString(),
  };
  const rows = [];

  const nTrials = Object.values(LIST.blocks).reduce((a, b) => a + b.length, 0);
  const nPractice = Object.values(window.PRACTICE).reduce((a, b) => a + b.length, 0);
  const estMin = Math.max(1, Math.round(((nTrials + nPractice) * (isTouch ? 3.5 : 3)) / 60));

  // ---------- utilitaires ---------------------------------------------------------------------
  const stim = (h) => `stim/${h}.png`;
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
  async function preload(list, onProgress) {
    let done = 0;
    await Promise.all(list.map((s) => load(s).then(() => onProgress && onProgress(++done / list.length))));
  }
  const pairSrcs = (trials) => trials.flatMap((t) => [stim(t.left), stim(t.right)]);

  function screen(html, cls = "") {
    app.className = "app " + cls;
    app.innerHTML = html;
    app.scrollTop = 0; window.scrollTo(0, 0);
    const h = app.querySelector("h1, h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }
  function onClick(sel, fn) { const el = app.querySelector(sel); if (el) el.addEventListener("click", fn); return el; }
  function button(label, cls = "") { return `<button type="button" class="btn ${cls}" id="next">${label}</button>`; }
  function next(sel = "#next") { return new Promise((res) => onClick(sel, res)); }

  // ---------- sauvegarde ----------------------------------------------------------------------
  const COLS = ["pid", "list", "device", "block_order", "color_vision", "question", "task", "kind", "trial_in_block",
    "left", "right", "correct", "choice", "chosen", "is_correct", "rt", "layout", "scale", "vw", "vh", "dpr",
    "screen_w", "screen_h", "study_id", "session_id", "source", "started_at", "user_agent"];
  function toCSV(rs) {
    const q = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [COLS.join(","), ...rs.map((r) => COLS.map((c) => q(r[c])).join(","))].join("\n");
  }
  async function send(part, rs) {
    if (CFG.DEMO || !CFG.SAVE_URL || !rs.length) return false;
    const body = JSON.stringify({ pid, list: listIdx, part, columns: COLS, rows: rs.map((r) => COLS.map((c) => r[c] ?? "")) });
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

  function runTrial(t, q, i, n, opts) {
    return new Promise(async (resolve) => {
      const [a, b] = await Promise.all([load(stim(t.left)), load(stim(t.right))]);
      const pct = n ? Math.round((i / n) * 100) : 0;
      app.className = "app trial";
      app.innerHTML = `
        <div class="trial-top">
          <div class="meta"><span>${esc(opts.label)}</span><span class="count">${opts.practice ? "Entraînement" : `${i + 1} / ${n}`}</span></div>
          <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <p class="q">${isTouch && SHORT[q] ? SHORT[q] : QUESTIONS[q]}</p>
        </div>
        <div class="stage" id="stage">
          <button type="button" class="pick" data-side="left" aria-label="Choisir la première image"><img alt="" draggable="false">${isTouch ? "" : '<span class="cap"><kbd>←</kbd></span>'}</button>
          <button type="button" class="pick" data-side="right" aria-label="Choisir la seconde image"><img alt="" draggable="false">${isTouch ? "" : '<span class="cap"><kbd>→</kbd></span>'}</button>
        </div>
        <p class="hint">${isTouch ? "Touchez l'image choisie" : "Cliquez sur l'image choisie, ou utilisez les flèches du clavier"}</p>`;
      const stage = app.querySelector("#stage");
      const els = [...stage.querySelectorAll("img")];
      els[0].src = a.src; els[1].src = b.src;
      let geo = layoutPair(stage, [a, b], els);
      const onResize = () => { geo = layoutPair(stage, [a, b], els); };
      addEventListener("resize", onResize);
      stage.classList.add("ready");
      const t0 = performance.now();
      let done = false;

      const choose = async (side) => {
        if (done || performance.now() - t0 < 250) return; // ignore les doubles appuis
        done = true;
        removeEventListener("keydown", onKey); removeEventListener("resize", onResize);
        const rt = Math.round(performance.now() - t0);
        stage.querySelector(`[data-side="${side}"]`).classList.add("chosen");
        const row = {
          ...session, question: q, task: opts.practice ? "practice" : "2afc", kind: t.kind, trial_in_block: i,
          left: t.left, right: t.right, correct: t.correct || "", choice: side,
          chosen: side === "left" ? t.left : t.right, rt, layout: geo.layout, scale: +geo.scale.toFixed(3),
          vw: innerWidth, vh: innerHeight,
        };
        if (t.correct) row.is_correct = side === t.correct;
        rows.push(row);
        await wait(160);
        resolve(row);
      };
      const onKey = (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); choose("left"); }
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); choose("right"); }
      };
      addEventListener("keydown", onKey);
      stage.querySelectorAll(".pick").forEach((p) => p.addEventListener("click", () => choose(p.dataset.side)));
    });
  }

  async function feedback(row) {
    const ok = row.is_correct;
    const where = isTouch ? (row.correct === "left" ? "celle du haut" : "celle du bas") : (row.correct === "left" ? "celle de gauche" : "celle de droite");
    const el = document.createElement("div");
    el.className = "toast " + (ok ? "ok" : "ko");
    el.setAttribute("role", "status");
    el.textContent = ok ? "Bonne réponse" : `La réponse attendue était ${where}`;
    app.appendChild(el);
    await wait(ok ? 700 : 1600);
  }

  // ---------- écrans --------------------------------------------------------------------------
  async function welcome() {
    screen(`
      <main class="sheet">
        <p class="eyebrow">Étude scientifique · ${estMin} min environ</p>
        <h1>Voyez-vous la différence&nbsp;?</h1>
        <p class="lede">Nous développons des méthodes pour corriger les défauts optiques des photos,
        comme les fines franges colorées qui apparaissent le long des contours. Votre œil est le meilleur juge :
        comparez des paires d'images et choisissez la meilleure.</p>
        <div class="demo-pair" aria-hidden="true">
          <figure><img src="${stim(window.PRACTICE[qNames[0]][0].left)}" alt=""></figure>
          <figure><img src="${stim(window.PRACTICE[qNames[0]][0].right)}" alt=""></figure>
        </div>
        <ul class="facts">
          <li><b>Anonyme.</b> Aucune donnée personnelle : seulement vos choix, vos temps de réponse et le type d'écran.</li>
          <li><b>Libre.</b> Vous pouvez arrêter à tout moment en fermant la page.</li>
          <li><b>Conseil.</b> Luminosité de l'écran au maximum, pas de mode nuit ni de filtre de lumière bleue.</li>
        </ul>
        ${CFG.DEMO ? `<p class="note">Version de démonstration avec des images factices : rien n'est enregistré.</p>` : ""}
        <div class="actions">${button("J'accepte, commencer")}</div>
        ${CFG.CONTACT ? `<p class="small">Responsable de l'étude : <span class="select">${esc(CFG.CONTACT)}</span></p>` : ""}
      </main>`, "light");
    await next();
  }

  async function profile() {
    screen(`
      <main class="sheet">
        <p class="eyebrow">Avant de commencer</p>
        <h1>Une seule question</h1>
        <fieldset class="choices" id="cv">
          <legend>Avez-vous un trouble connu de la vision des couleurs (daltonisme) ?</legend>
          <label><input type="radio" name="cv" value="non" id="cv-non"> Non</label>
          <label><input type="radio" name="cv" value="oui" id="cv-oui"> Oui</label>
          <label><input type="radio" name="cv" value="ne_sait_pas" id="cv-nsp"> Je ne sais pas</label>
        </fieldset>
        ${!isTouch ? `<p class="small">Si possible, passez la fenêtre en plein écran.</p>` : ""}
        <div class="actions">${button("Continuer")}</div>
      </main>`, "light");
    const btn = app.querySelector("#next");
    btn.disabled = true;
    app.querySelectorAll('input[name="cv"]').forEach((r) => r.addEventListener("change", () => { btn.disabled = false; }));
    await next();
    session.color_vision = app.querySelector('input[name="cv"]:checked').value;
    if (!isTouch && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch (e) { /* refusé : on continue */ }
    }
  }

  async function blockIntro(q, bi) {
    const p = window.PRACTICE[q][0];
    const good = p.correct === "left" ? p.left : p.right, bad = p.correct === "left" ? p.right : p.left;
    const isF = q === "fringes";
    screen(`
      <main class="sheet">
        <p class="eyebrow">Partie ${bi + 1} sur ${blockOrder.length}</p>
        <h1>${isF ? "Les franges colorées" : "Le naturel"}</h1>
        <p class="lede">${isF
          ? "De fins liserés violets, verts ou bleus apparaissent le long des contours contrastés. Choisissez l'image où on les voit le moins."
          : "Choisissez l'image qui paraît la plus naturelle : ni floue, ni lissée, sans couleurs ni motifs artificiels."}</p>
        <div class="example">
          <figure><img src="${stim(bad)}" alt=""><figcaption>${isF ? "Franges visibles" : "Floue, peu naturelle"}</figcaption></figure>
          <figure class="good"><img src="${stim(good)}" alt=""><figcaption>${isF ? "Moins de franges : à choisir" : "Plus naturelle : à choisir"}</figcaption></figure>
        </div>
        <p>Les différences sont souvent <b>subtiles</b>. Si les deux images vous semblent identiques, choisissez au mieux : il faut toujours répondre.</p>
        <p class="small">Quelques essais d'entraînement corrigés pour commencer.</p>
        <div class="actions">${button("S'entraîner")}</div>
      </main>`, "light");
    await next();
  }

  async function message(eyebrow, title, text, label, cls = "light") {
    screen(`<main class="sheet compact"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${text}<div class="actions">${button(label)}</div></main>`, cls);
    await next();
  }

  async function loading(srcs, label) {
    screen(`<main class="sheet compact"><p class="eyebrow">Chargement</p><h1>${label}</h1>
      <div class="bar big" aria-hidden="true"><i id="lp" style="width:0%"></i></div></main>`, "light");
    const lp = app.querySelector("#lp");
    await preload(srcs, (f) => { lp.style.width = Math.round(f * 100) + "%"; });
  }

  async function finish(allSaved) {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
    const n = rows.filter((r) => r.task === "2afc").length;
    const shareUrl = location.origin + location.pathname;
    const showDownload = !CFG.DEMO && !CFG.SAVE_URL;
    screen(`
      <main class="sheet">
        <p class="eyebrow">Terminé · ${n} comparaisons</p>
        <h1>Merci&nbsp;!</h1>
        <p class="lede">${CFG.DEMO ? "C'était la version de démonstration : vos réponses n'ont pas été enregistrées."
          : allSaved ? "Vos réponses ont bien été enregistrées. Elles nous aideront à évaluer nos méthodes de correction d'images."
          : showDownload ? "Téléchargez vos réponses et transmettez le fichier au responsable de l'étude."
          : "L'envoi automatique de vos réponses a échoué. Téléchargez-les et transmettez le fichier au responsable de l'étude."}</p>
        ${!allSaved && !CFG.DEMO ? `<div class="actions">${button("Télécharger mes réponses", "secondary")}</div>` : ""}
        <div class="share">
          <p>Plus il y a de participants, plus les résultats sont fiables. Partagez l'étude&nbsp;:</p>
          <div class="copy"><span class="select" id="url">${esc(shareUrl)}</span><button type="button" class="btn small-btn" id="copy">Copier le lien</button></div>
        </div>
        ${CFG.COMPLETION_URL ? `<div class="actions"><a class="btn" href="${esc(CFG.COMPLETION_URL)}">Terminer l'étude</a></div>` : ""}
      </main>`, "light");
    onClick("#next", () => download(`responses_${pid}_list${listIdx}.csv`, toCSV(rows)));
    onClick("#copy", async (e) => {
      try { await navigator.clipboard.writeText(shareUrl); e.target.textContent = "Lien copié"; }
      catch (err) { const r = document.createRange(); r.selectNodeContents(app.querySelector("#url")); getSelection().removeAllRanges(); getSelection().addRange(r); }
    });
  }

  // ---------- déroulé -------------------------------------------------------------------------
  async function main() {
    load(stim(window.PRACTICE[qNames[0]][0].left)); load(stim(window.PRACTICE[qNames[0]][0].right));
    await welcome();
    await profile();
    let allSaved = true;
    for (const [bi, q] of blockOrder.entries()) {
      const label = `Partie ${bi + 1}/${blockOrder.length}`;
      const trials = LIST.blocks[q];
      // on ne précharge que l'entraînement et le début de la partie ; la suite se charge pendant les essais
      await loading([...pairSrcs(window.PRACTICE[q]), ...pairSrcs(trials.slice(0, 8))], "Préparation des images…");
      await blockIntro(q, bi);
      for (const [i, t] of window.PRACTICE[q].entries()) {
        const row = await runTrial(t, q, i, 0, { practice: true, label });
        await feedback(row);
      }
      await message("Entraînement terminé", "C'est parti", `<p class="lede">${trials.length} comparaisons, sans correction cette fois.
        ${trials.length > window.PAUSE_EVERY ? "Des pauses sont prévues en chemin." : ""}</p>`, "Commencer");
      const start = rows.length;
      for (const [i, t] of trials.entries()) {
        if (i > 0 && i % window.PAUSE_EVERY === 0) {
          await message("Pause", "Reposez vos yeux", `<p class="lede">${i} sur ${trials.length} dans cette partie. Reprenez quand vous voulez.</p>`, "Reprendre");
        }
        pairSrcs(trials.slice(i + 1, i + 9)).forEach(load);
        await runTrial(t, q, i, trials.length, { practice: false, label });
      }
      const ok = await send(bi + 1, rows.slice(start).concat(rows.slice(0, start).filter((r) => r.task === "practice" && r.question === q)));
      allSaved = allSaved && (ok || CFG.DEMO);
      if (bi < blockOrder.length - 1) {
        await message(`Partie ${bi + 1} terminée`, "Plus qu'une partie", `<p class="lede">Même principe, avec une autre question.</p>`, "Continuer");
      }
    }
    await finish(allSaved && !!CFG.SAVE_URL || CFG.DEMO);
  }

  main();
})();
