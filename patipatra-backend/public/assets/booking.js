import { api, ApiError, el, icon, chrome, toast } from "/assets/site.js";

const grid = document.getElementById("grid");
const chipsBox = document.getElementById("chips");
const bar = document.getElementById("bar");
const dlg = document.getElementById("dlg");
const form = document.getElementById("form");
const doneBox = document.getElementById("done");
const formError = document.getElementById("form-error");

let services = [];
let settings = null;
let activeCategory = "All";
const selected = new Set();

document.getElementById("dlg-close").append(icon("x", 18));

const customSelected = () => services.some((s) => s.is_custom && selected.has(s.id));

function card(s) {
  const input = el("input", { type: "checkbox", value: String(s.id), id: `svc-${s.id}`, "aria-label": `${s.title_en} (${s.title_bn})`, checked: selected.has(s.id) });
  input.addEventListener("change", () => {
    if (input.checked) selected.add(s.id);
    else selected.delete(s.id);
    refreshBar();
  });
  const media = el("span", { class: "svc-media" });
  if (s.image_url) {
    const img = el("img", { src: s.image_url, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => {
      img.remove();
      media.append(el("span", { class: "ph bn", text: s.title_bn }));
    });
    media.append(img);
  } else {
    media.append(el("span", { class: "ph bn", text: s.title_bn }));
  }
  return el(
    "label",
    { class: "svc", for: `svc-${s.id}` },
    input,
    el(
      "span",
      { class: "svc-card" },
      media,
      el("span", { class: "svc-tick" }, icon("check", 18)),
      el("span", { class: "svc-text" }, el("span", { class: "bn", text: s.title_bn }), el("span", { class: "sc", text: s.title_en }), el("span", { class: "desc", text: s.description }))
    )
  );
}

function renderGrid() {
  grid.replaceChildren();
  const list = activeCategory === "All" ? services : services.filter((s) => s.category === activeCategory);
  list.forEach((s) => grid.append(card(s)));
  grid.setAttribute("aria-busy", "false");
}

function renderChips(categories) {
  chipsBox.replaceChildren();
  ["All", ...categories].forEach((c) => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(c === activeCategory), text: c });
    b.addEventListener("click", () => {
      activeCategory = c;
      renderChips(categories);
      renderGrid();
    });
    chipsBox.append(b);
  });
}

function refreshBar() {
  const n = selected.size;
  bar.hidden = n === 0;
  document.getElementById("bar-count").textContent = `${n} item${n === 1 ? "" : "s"} selected`;
  document.getElementById("bar-names").textContent = services.filter((s) => selected.has(s.id)).map((s) => s.title_en).join(" · ");
}

function renderSummary() {
  const box = document.getElementById("summary");
  box.replaceChildren();
  services
    .filter((s) => selected.has(s.id))
    .forEach((s) => {
      const rm = el("button", { type: "button", "aria-label": `Remove ${s.title_en}` }, icon("x", 12));
      rm.addEventListener("click", () => {
        selected.delete(s.id);
        const cb = document.getElementById(`svc-${s.id}`);
        if (cb) cb.checked = false;
        refreshBar();
        if (selected.size === 0) dlg.close();
        else renderSummary();
        syncMessageLabel();
      });
      box.append(el("span", { class: "pill" }, el("span", { class: "bn", text: s.title_bn }), el("span", { text: `· ${s.title_en}` }), rm));
    });
}

function syncMessageLabel() {
  const label = document.getElementById("msg-label");
  label.replaceChildren();
  if (customSelected()) label.append("Tell us what you would like us to make ", el("span", { class: "opt", text: "(required for custom orders)" }));
  else label.append("Anything you would like us to know ", el("span", { class: "opt", text: "(optional)" }));
}

function renderAdvance() {
  const box = document.getElementById("advance-note");
  box.replaceChildren();
  if (!settings) return;
  box.append(el("strong", { text: settings.advance_message_en }), el("span", { class: "bn", text: settings.advance_message_bn }));
}

function clearErrors() {
  formError.textContent = "";
  form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
}

function openDialog() {
  if (selected.size === 0) return;
  doneBox.hidden = true;
  form.hidden = false;
  clearErrors();
  renderSummary();
  renderAdvance();
  syncMessageLabel();
  const dateInput = form.elements.event_date;
  const t = new Date();
  dateInput.min = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  dlg.showModal();
}

function showError(message, field) {
  formError.textContent = message;
  const wrap = document.getElementById(`f-${field}`);
  if (wrap) {
    wrap.classList.add("invalid");
    wrap.querySelector("input,textarea")?.focus();
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showDone(r) {
  form.hidden = true;
  doneBox.hidden = false;
  doneBox.replaceChildren(
    el(
      "div",
      { class: "body done" },
      el("div", { class: "done-icon" }, icon("check", 34)),
      el("div", {}, el("h2", { class: "bn", style: { margin: "0", color: "var(--red)", fontWeight: "500" }, text: "বুকিং গ্রহণ করা হয়েছে!" }), el("span", { class: "sc", text: "Booking received" })),
      el("div", { class: "refbox" }, el("div", { class: "sc", text: "Your booking ID" }), el("div", { class: "code", text: r.booking.ref })),
      el("div", { class: "summary", style: { justifyContent: "center" } }, r.booking.items.map((i) => el("span", { class: "pill", style: { paddingRight: ".8rem" } }, `${i.title_bn} · ${i.title_en}`))),
      el("div", { class: "note-box", style: { textAlign: "left" } }, el("strong", { text: r.advance_message_en }), el("span", { class: "bn", text: r.advance_message_bn })),
      el(
        "p",
        { style: { margin: "0" } },
        el("strong", { text: "Please contact us now so we can listen to exactly what you need." }),
        el("br"),
        el("span", { class: "bn", text: "আপনি ঠিক কী চান তা শুনতে আমাদের সঙ্গে এখনই যোগাযোগ করুন।" })
      ),
      el(
        "div",
        { class: "contact-actions" },
        el("a", { class: "btn primary block", href: r.contact.call_url }, icon("phone", 18), `Call ${r.contact.organiser_name} · ${r.contact.phone}`),
        el("a", { class: "btn green block", href: r.contact.whatsapp_url, target: "_blank", rel: "noopener" }, icon("chat", 18), "Message on WhatsApp")
      ),
      el(
        "div",
        { class: "linkbox" },
        el("strong", { text: "Your review link" }),
        el("div", { class: "muted", style: { color: "var(--muted)" }, text: r.review_note_en }),
        el("div", { class: "bn", style: { color: "var(--muted)" }, text: r.review_note_bn }),
        el("code", { text: r.review_url }),
        el("button", {
          type: "button",
          class: "btn small",
          text: "Copy link",
          onClick: async (e) => {
            const ok = await copyText(r.review_url);
            e.target.textContent = ok ? "Copied!" : "Select the link above and copy it";
          },
        })
      ),
      el(
        "div",
        { style: { display: "flex", gap: ".6rem", justifyContent: "center", flexWrap: "wrap" } },
        el("button", { type: "button", class: "btn small", text: "Book more items", onClick: () => dlg.close() }),
        el("a", { class: "btn small", href: "/gallery", text: "See our gallery" })
      )
    )
  );
  doneBox.scrollIntoView?.({ block: "start" });
  dlg.scrollTop = 0;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  const f = form.elements;
  const name = f.name.value.trim();
  const phone = f.phone.value.trim();
  if (name.length < 2) return showError("Please enter your name.", "name");
  if (phone.replace(/\D/g, "").length < 10) return showError("Please enter your 10-digit mobile number.", "phone");
  if (customSelected() && f.message.value.trim().length < 5) return showError("Please tell us a little about what you would like us to make.", "message");

  const btn = document.getElementById("submit");
  btn.disabled = true;
  btn.textContent = "Confirming…";
  try {
    const r = await api("/api/bookings", {
      method: "POST",
      body: {
        service_ids: [...selected],
        name,
        phone,
        email: f.email.value.trim(),
        event_date: f.event_date.value,
        city: f.city.value.trim(),
        message: f.message.value.trim(),
        website: f.website.value,
      },
    });
    if (!r.booking) {
      // Honeypot response (never shown to real visitors).
      dlg.close();
      return;
    }
    selected.clear();
    grid.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
    refreshBar();
    form.reset();
    showDone(r);
  } catch (err) {
    const field = err instanceof ApiError ? err.field : "";
    if (field === "service_ids") {
      formError.textContent = err.message;
    } else {
      showError(err.message || "Something went wrong. Please try again.", field);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm booking";
  }
});

document.getElementById("bar-confirm").addEventListener("click", openDialog);
document.getElementById("bar-clear").addEventListener("click", () => {
  selected.clear();
  grid.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
  refreshBar();
});
document.getElementById("dlg-close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => {
  if (e.target === dlg) dlg.close();
});

(async function init() {
  [settings] = await Promise.all([chrome("/booking")]);
  try {
    const data = await api("/api/services");
    services = data.services;
    renderChips(data.categories);

    // Allow links like /booking?service=kalka,kulo from other pages
    const wanted = (new URLSearchParams(location.search).get("service") || "").split(",").map((x) => x.trim()).filter(Boolean);
    services.filter((s) => wanted.includes(s.slug)).forEach((s) => selected.add(s.id));

    renderGrid();
    refreshBar();
  } catch (err) {
    grid.setAttribute("aria-busy", "false");
    document.getElementById("load-error").textContent = err.message;
    toast(err.message, { error: true });
  }
})();
