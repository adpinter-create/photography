/* Andrei Pinter Photography: hash-routed single page.
   #/                      places index over a full-bleed photograph
   #/places/<slug>[/<id>]  one place, optionally with a photograph open
   #/all[/<id>]            every photograph, newest first
   #/about                 about */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = $("#view"), bar = $("#bar"), stage = $("#stage");
  let D, P = {}, byId = {}, current = { key: null }, lbList = [], lbIndex = -1;

  const img = (id, size) => `img/${size}/${id}.jpg`;
  const srcset = id => `${img(id, "sm")} 640w, ${img(id, "md")} 1280w, ${img(id, "lg")} 2048w`;
  const placeName = ph => P[ph.p].name;
  const where = ph => ph.city ? `${ph.city}, ${placeName(ph)}` : placeName(ph);
  const titleOf = ph => ph.title || ph.landmark || where(ph);
  const altOf = ph => [ph.title, ph.landmark, where(ph)].filter(Boolean).join(", ");
  const yearsText = y => !y || !y.length ? "" : y[0] === y[1] ? y[0] : `${y[0]} to ${y[1]}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const coordText = c => {
    if (!c) return "";
    const [la, lo] = c;
    return `${Math.abs(la).toFixed(2)}° ${la >= 0 ? "N" : "S"}, ${Math.abs(lo).toFixed(2)}° ${lo >= 0 ? "E" : "W"}`;
  };
  const setAccent = a => document.documentElement.style.setProperty("--accent", a);

  // ---------- data ----------
  fetch("data.json").then(r => r.json()).then(d => {
    D = d;
    D.places.forEach(p => { P[p.slug] = p; p.photos = []; });
    D.photos.forEach(ph => { byId[ph.id] = ph; P[ph.p].photos.push(ph); });
    route();
    addEventListener("hashchange", route);
    window.requestIdleCallback ? requestIdleCallback(preloadCovers) : setTimeout(preloadCovers, 1500);
  }).catch(() => { view.innerHTML = `<p class="noscript">The photographs didn't load. Refresh the page to try again.</p>`; });

  function preloadCovers() {
    const size = innerWidth * devicePixelRatio > 1500 ? "lg" : "md";
    D.places.forEach((p, i) => setTimeout(() => { const im = new Image(); im.src = img(p.cover, size); }, i * 250));
  }

  // ---------- router ----------
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    let key, render, photo = null;
    if (parts[0] === "places" && P[parts[1]]) { key = "place:" + parts[1]; render = () => placeView(P[parts[1]]); photo = parts[2]; }
    else if (parts[0] === "all") { key = "all"; render = allView; photo = parts[1]; }
    else if (parts[0] === "about") { key = "about"; render = aboutView; }
    else { key = "home"; render = homeView; }
    if (key !== current.key) {
      closeLightbox(true);
      pushed = false;
      current = { key };
      document.body.classList.toggle("home", key === "home");
      document.querySelectorAll("[data-nav]").forEach(a => a.setAttribute("aria-current", a.dataset.nav === key.split(":")[0] || (a.dataset.nav === "home" && key.startsWith("place")) ? "page" : "false"));
      render();
      scrollTo(0, 0);
      onScroll();
    }
    if (photo && byId[photo]) openLightbox(photo); else closeLightbox();
  }

  // ---------- home ----------
  let stageFront = 0, activeSlug = null;
  function homeView() {
    document.title = "Andrei Pinter Photography";
    const list = D.places.map((p, i) => `<li style="--i:${i}"><a class="place" href="#/places/${p.slug}" data-slug="${p.slug}" style="--accent:${p.accent}">
      <span>${esc(p.name)}</span><span class="n" aria-label="${plural(p.count, "photograph")}">${p.count}</span></a></li>`).join("");
    view.innerHTML = `<section class="index" aria-label="Places"><h1 class="sr">Photographs by place</h1><ol>${list}</ol></section>
      <div class="wall" id="wall" aria-live="polite"></div>`;
    const links = [...view.querySelectorAll(".place")];
    links.forEach(a => {
      a.addEventListener("mouseenter", () => showPlace(a.dataset.slug));
      a.addEventListener("focus", () => showPlace(a.dataset.slug));
    });
    // on touch screens the place nearest the middle of the screen lights up as you scroll
    if (matchMedia("(hover: none)").matches) {
      const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && showPlace(e.target.dataset.slug)),
        { rootMargin: "-46% 0px -46% 0px" });
      links.forEach(a => io.observe(a));
    }
    showPlace(activeSlug || D.places[0].slug, true);
    if (!document.body.classList.contains("lit")) {
      document.body.classList.add("intro");
      requestAnimationFrame(() => requestAnimationFrame(() => { document.body.classList.add("lit"); document.body.classList.remove("intro"); }));
    }
  }

  function showPlace(slug, first) {
    if (slug === activeSlug && !first) return;
    activeSlug = slug;
    const p = P[slug], ph = byId[p.cover];
    setAccent(p.accent);
    view.querySelectorAll(".place").forEach(a => a.classList.toggle("on", a.dataset.slug === slug));
    const imgs = stage.querySelectorAll("img"), next = imgs[1 - stageFront], prev = imgs[stageFront];
    if (prev.dataset.id === ph.id && prev.classList.contains("on")) return label(p, ph);
    next.onload = () => { next.classList.add("on"); prev.classList.remove("on"); };
    next.dataset.id = ph.id;
    next.sizes = "100vw";
    next.srcset = `${img(ph.id, "md")} 1280w, ${img(ph.id, "lg")} 2048w`;
    next.src = img(ph.id, "md");
    if (next.complete && next.naturalWidth) next.onload();
    stageFront = 1 - stageFront;
    label(p, ph);
  }

  function label(p, ph) {
    const w = $("#wall");
    if (!w) return;
    w.innerHTML = `<p class="t">${esc(titleOf(ph))}</p><p class="s">${esc([ph.landmark || ph.title ? where(ph) : "", ph.date].filter(Boolean).join(", "))}</p>`;
  }

  // ---------- justified rows ----------
  function justify(container, photos, base) {
    const cs = getComputedStyle(container);
    const width = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = 6;
    const target = base || (width < 560 ? 150 : width < 900 ? 210 : Math.min(380, Math.max(240, width * 0.22)));
    let html = "", row = [], sum = 0;
    const flush = (h, last) => {
      html += `<div class="row" style="height:${h.toFixed(1)}px">` + row.map(ph => {
        const w = (ph.w / ph.h) * h;
        return `<a class="tile" href="${tileHref(ph)}" style="width:${w.toFixed(1)}px;--c:${ph.c}" aria-label="${esc(altOf(ph))}">
          <img loading="lazy" decoding="async" alt="${esc(altOf(ph))}" src="${img(ph.id, "sm")}" srcset="${srcset(ph.id)}" sizes="${Math.ceil(w)}px" width="${Math.round(w)}" height="${Math.round(h)}"></a>`;
      }).join("") + `</div>`;
      row = []; sum = 0;
    };
    photos.forEach(ph => {
      row.push(ph); sum += ph.w / ph.h;
      if (sum * target + gap * (row.length - 1) >= width) flush((width - gap * (row.length - 1)) / sum);
    });
    if (row.length) flush(Math.min(target, (width - gap * (row.length - 1)) / sum), true);
    container.innerHTML = html;
    container.querySelectorAll("img").forEach(im => {
      if (im.complete && im.naturalWidth) im.classList.add("in");
      else im.addEventListener("load", () => im.classList.add("in"), { once: true });
    });
  }
  let tileBase = "";
  const tileHref = ph => `${tileBase}/${ph.id}`;
  let relayout = null;
  addEventListener("resize", () => { clearTimeout(relayout); relayout = setTimeout(() => current.layout && current.layout(), 160); });

  // ---------- place ----------
  function placeView(p) {
    document.title = `${p.name}, Andrei Pinter Photography`;
    setAccent(p.accent);
    tileBase = `#/places/${p.slug}`;
    const cover = byId[p.cover];
    const i = D.places.indexOf(p), nextP = D.places[(i + 1) % D.places.length];
    const cities = p.cities.length > 1 ? `<ul class="cities" aria-label="Filter by city">
        <li><button aria-pressed="true" data-city="">All<span class="k">${p.count}</span></button></li>
        ${p.cities.map(([c, n]) => `<li><button aria-pressed="false" data-city="${esc(c)}">${esc(c)}<span class="k">${n}</span></button></li>`).join("")}</ul>` : "";
    view.innerHTML = `<section class="cover" style="--c:${cover.c}">
        <img alt="${esc(altOf(cover))}" srcset="${img(cover.id, "md")} 1280w, ${img(cover.id, "lg")} 2048w" sizes="100vw" src="${img(cover.id, "md")}">
        <h1 class="ptitle">${esc(p.name)}</h1></section>
      <div class="pmeta"><span class="count">${plural(p.count, "photograph")}${p.years.length ? ", " + yearsText(p.years) : ""}</span>
        ${p.coords ? `<span class="coords" title="${esc(p.city || p.name)}">${coordText(p.coords)}</span>` : ""}</div>
      ${cities}
      <div class="grid" id="grid"></div>
      <a class="next" href="#/places/${nextP.slug}" style="--accent:${nextP.accent}"><small>Next place</small><b>${esc(nextP.name)}</b></a>
      ${footer()}`;
    const cimg = $(".cover img", view);
    cimg.complete && cimg.naturalWidth ? cimg.classList.add("in") : cimg.addEventListener("load", () => cimg.classList.add("in"), { once: true });
    let shown = p.photos;
    const grid = $("#grid");
    current.layout = () => justify(grid, shown);
    current.layout();
    lbList = shown;
    view.querySelectorAll(".cities button").forEach(b => b.addEventListener("click", () => {
      view.querySelectorAll(".cities button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      shown = b.dataset.city ? p.photos.filter(ph => ph.city === b.dataset.city) : p.photos;
      lbList = shown;
      current.layout();
    }));
  }

  // ---------- all ----------
  function allView() {
    document.title = "All photographs, Andrei Pinter Photography";
    setAccent(D.places[0].accent);
    tileBase = "#/all";
    const groups = {};
    D.photos.forEach(ph => { const y = ph.taken ? ph.taken.slice(0, 4) : "Undated"; (groups[y] = groups[y] || []).push(ph); });
    const years = Object.keys(groups).sort((a, b) => (b === "Undated") - (a === "Undated") || b.localeCompare(a));
    years.forEach(y => groups[y].sort((a, b) => (b.taken || "").localeCompare(a.taken || "")));
    lbList = years.flatMap(y => groups[y]);
    view.innerHTML = `<header class="page-head"><h1>All photographs</h1>
        <p>${plural(D.photos.length, "photograph")} from ${D.places.length} places, newest first.</p></header>
      ${years.map(y => `<h2 class="year">${y}<small>${plural(groups[y].length, "photograph")}</small></h2><div class="grid" data-year="${y}"></div>`).join("")}
      ${footer()}`;
    current.layout = () => view.querySelectorAll(".grid").forEach(g => justify(g, groups[g.dataset.year]));
    current.layout();
  }

  // ---------- about ----------
  function aboutView() {
    document.title = "About, Andrei Pinter Photography";
    current.layout = null;
    const years = D.photos.map(p => p.taken).filter(Boolean).map(t => t.slice(0, 4)).sort();
    view.innerHTML = `<section class="about">
        <div>
          <p class="lede">Photographs by Andrei Pinter, from Kansas City to Seoul: skylines after dark, old palaces, open water and the occasional animal.</p>
          <p>Every photograph here is arranged by where it was taken, by state in the US and by country everywhere else. Open any place to see the set, or browse all of them by year.</p>
          <blockquote>“You don’t take a photograph, you make it.”<cite>Ansel Adams</cite></blockquote>
        </div>
        <div>
          <dl class="figures">
            <div><dt>photographs</dt><dd>${D.photos.length}</dd></div>
            <div><dt>places</dt><dd>${D.places.length}</dd></div>
            <div><dt>years</dt><dd>${years[0]}–${years[years.length - 1].slice(2)}</dd></div>
          </dl>
          <h2>Elsewhere</h2>
          <ul class="links">
            <li><a href="https://instagram.com/andreipinter" rel="noopener"><span>Instagram</span><span>@andreipinter</span></a></li>
            <li><a href="https://www.linkedin.com/in/andreipinter/" rel="noopener"><span>LinkedIn</span><span>Andrei Pinter</span></a></li>
          </ul>
          <h2>Other work</h2>
          <ul class="links">
            <li><a href="https://pulse.andreipinter.com/"><span>Pulse News</span><span>Markets and news</span></a></li>
            <li><a href="https://supplychain.andreipinter.com/"><span>Supply chain dashboards</span><span>Capacity and planning</span></a></li>
            <li><a href="https://excel.andreipinter.com/"><span>Excel shortcuts</span><span>Keyboard guide</span></a></li>
            <li><a href="https://tv.andreipinter.com/"><span>TV tech guide</span><span>The physics of the picture</span></a></li>
          </ul>
        </div>
      </section>${footer()}`;
  }

  function footer() {
    return `<footer class="foot"><span>© ${new Date().getFullYear()} Andrei Pinter. All photographs are copyrighted; please ask before using them.</span>
      <nav><a href="https://instagram.com/andreipinter" rel="noopener">Instagram</a><a href="https://www.linkedin.com/in/andreipinter/" rel="noopener">LinkedIn</a></nav></footer>`;
  }

  // ---------- header ----------
  function onScroll() { bar.classList.toggle("solid", current.key !== "home" && scrollY > 40); }
  addEventListener("scroll", onScroll, { passive: true });

  // ---------- lightbox ----------
  const lb = $("#lb"), lbImg = $("#lb-img");
  let lastFocus = null, idleT = null, pushed = false;
  function openLightbox(id) {
    const ph = byId[id];
    if (!lbList.includes(ph)) lbList = current.key === "all" ? lbList : P[ph.p].photos;
    lbIndex = lbList.indexOf(ph);
    if (lb.hidden) {
      lastFocus = document.activeElement;
      lb.hidden = false;
      document.body.classList.add("lb-open");
      $("#lb-close").focus({ preventScroll: true });
    }
    setAccent(P[ph.p].accent);
    lbImg.classList.remove("in");
    lbImg.style.setProperty("--c", ph.c);
    lbImg.alt = altOf(ph);
    lbImg.onload = () => lbImg.classList.add("in");
    lbImg.sizes = "100vw";
    lbImg.srcset = `${img(ph.id, "md")} 1280w, ${img(ph.id, "lg")} 2048w`;
    lbImg.src = img(ph.id, "lg");
    if (lbImg.complete && lbImg.naturalWidth) lbImg.classList.add("in");
    $("#lb-title").textContent = titleOf(ph);
    $("#lb-sub").textContent = [ph.landmark || ph.title ? where(ph) : "", ph.date].filter(Boolean).join(", ");
    $("#lb-gear").innerHTML = [ph.camera, ph.lens, ph.exposure].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join("");
    $("#lb-count").textContent = `${lbIndex + 1} of ${lbList.length}`;
    [lbList[lbIndex + 1], lbList[lbIndex - 1]].forEach(n => { if (n) { const im = new Image(); im.src = img(n.id, "lg"); } });
    wake();
  }
  function closeLightbox(silent) {
    if (lb.hidden) return;
    lb.hidden = true;
    document.body.classList.remove("lb-open");
    lbImg.removeAttribute("src"); lbImg.removeAttribute("srcset");
    if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    // keep the place's colour after closing a photo opened from "All"
    if (current.key.startsWith("place:")) setAccent(P[current.key.slice(6)].accent);
  }
  function step(d) {
    if (!lbList.length) return;
    const n = lbList[(lbIndex + d + lbList.length) % lbList.length];
    history.replaceState(null, "", `${tileBase}/${n.id}`);
    openLightbox(n.id);
  }
  function exit() { if (pushed) { pushed = false; history.back(); } else location.hash = tileBase; }
  // links to photos push history, so Back closes the photo
  view.addEventListener("click", e => {
    const a = e.target.closest("a.tile");
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    pushed = true;
    route();
  });
  addEventListener("popstate", route);
  $("#lb-prev").onclick = () => step(-1);
  $("#lb-next").onclick = () => step(1);
  $("#lb-close").onclick = exit;
  addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "Escape") exit();
    else if (e.key === "Tab") {           // keep focus inside the dialog
      const f = [...lb.querySelectorAll("button")].filter(b => b.offsetParent);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  function wake() { lb.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => lb.classList.add("idle"), 2600); }
  lb.addEventListener("mousemove", wake);
  // swipe left/right to move, swipe down to close
  let tx = 0, ty = 0, tt = 0;
  lb.addEventListener("touchstart", e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = Date.now(); }, { passive: true });
  lb.addEventListener("touchend", e => {
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Date.now() - tt > 700) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) exit();
  }, { passive: true });
  // tap the photo on a phone to step forward
  lbImg.addEventListener("click", () => { if (matchMedia("(hover: none)").matches) step(1); });

  document.querySelector(".skip").addEventListener("click", e => { e.preventDefault(); view.focus(); });
  document.body.classList.remove("loading");
  void reduced;
})();
