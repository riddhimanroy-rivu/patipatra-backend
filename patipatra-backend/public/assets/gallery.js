import { api, el, chrome, stars, fmtDate } from "/assets/site.js";

const gal = document.getElementById("gal");
const empty = document.getElementById("empty");
const lb = document.getElementById("lb");
const stage = document.getElementById("lb-stage");
const cap = document.getElementById("lb-cap");

let items = [];
let shown = [];
let filter = "all";
let index = 0;

document.getElementById("lb-close").textContent = "×";
document.getElementById("lb-prev").textContent = "‹";
document.getElementById("lb-next").textContent = "›";

function thumb(item, i) {
  const media =
    item.kind === "video"
      ? el("video", { src: `${item.url}#t=0.5`, preload: "metadata", muted: true, playsinline: true, "aria-hidden": "true", tabindex: "-1" })
      : el("img", { src: item.url, alt: item.title || "Patipatra craft", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  const b = el(
    "button",
    { type: "button", class: "gal-item", "aria-label": `${item.kind === "video" ? "Play video" : "View photo"}${item.title ? ": " + item.title : ""}` },
    media,
    item.kind === "video" ? el("span", { class: "play", text: "Video" }) : null,
    item.title || item.service_title ? el("span", { class: "cap", text: item.title || item.service_title }) : null
  );
  b.addEventListener("click", () => openAt(i));
  return b;
}

function render() {
  shown = items.filter((x) => filter === "all" || x.kind === filter);
  gal.replaceChildren(...shown.map(thumb));
  gal.setAttribute("aria-busy", "false");
  empty.hidden = shown.length > 0;
}

function renderKinds() {
  const box = document.getElementById("kinds");
  box.replaceChildren();
  const hasVideo = items.some((x) => x.kind === "video");
  const hasPhoto = items.some((x) => x.kind === "photo");
  const opts = [["all", "All"]];
  if (hasPhoto) opts.push(["photo", "Photos"]);
  if (hasVideo) opts.push(["video", "Videos"]);
  if (opts.length === 1) return;
  opts.forEach(([k, label]) => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(filter === k), text: label });
    b.addEventListener("click", () => {
      filter = k;
      renderKinds();
      render();
    });
    box.append(b);
  });
}

function show() {
  const item = shown[index];
  if (!item) return;
  stage.replaceChildren(
    item.kind === "video"
      ? el("video", { src: item.url, controls: true, autoplay: true, playsinline: true })
      : el("img", { src: item.url, alt: item.title || "Patipatra craft", referrerpolicy: "no-referrer" })
  );
  cap.textContent = [item.title, item.service_title].filter(Boolean).join(" · ");
  const many = shown.length > 1;
  document.getElementById("lb-prev").hidden = !many;
  document.getElementById("lb-next").hidden = !many;
}

function openAt(i) {
  index = i;
  show();
  lb.showModal();
}
function step(d) {
  if (shown.length < 2) return;
  index = (index + d + shown.length) % shown.length;
  show();
}

document.getElementById("lb-prev").addEventListener("click", () => step(-1));
document.getElementById("lb-next").addEventListener("click", () => step(1));
document.getElementById("lb-close").addEventListener("click", () => lb.close());
lb.addEventListener("close", () => stage.replaceChildren()); // stops any playing video
lb.addEventListener("click", (e) => {
  if (e.target === lb || e.target === stage) lb.close();
});
lb.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

(async function init() {
  chrome("/gallery");
  try {
    const data = await api("/api/gallery");
    items = data.items;
    renderKinds();
    render();
  } catch (err) {
    gal.setAttribute("aria-busy", "false");
    document.getElementById("load-error").textContent = err.message;
  }
  try {
    const r = await api("/api/reviews");
    if (r.reviews.length) {
      document.getElementById("reviews-section").hidden = false;
      document.getElementById("rev-summary").textContent = `${r.average} / 5 from ${r.count} review${r.count === 1 ? "" : "s"}`;
      document.getElementById("revs").replaceChildren(
        ...r.reviews.map((v) =>
          el("article", { class: "rev" }, stars(v.rating), v.comment ? el("p", { text: v.comment }) : null, el("div", { class: "who", text: `${v.name} · ${fmtDate(v.created_at)}` }))
        )
      );
    }
  } catch {
    /* reviews are optional on this page */
  }
})();
