import { api, ApiError, el, chrome, stars } from "/assets/site.js";

const box = document.getElementById("box");
const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");

function message(bn, en, extra) {
  box.replaceChildren(el("div", { class: "center stack" }, el("p", { class: "bn", style: { fontSize: "1.4rem", margin: 0, color: "var(--red)" }, text: bn }), el("p", { style: { margin: 0 }, text: en }), extra));
}

function thanks(rating, comment) {
  message(
    "ধন্যবাদ! আপনার মতামত আমাদের কাছে অনেক মূল্যবান।",
    "Thank you! Your review means a lot to us.",
    el("div", { class: "stack center" }, stars(rating), comment ? el("p", { style: { fontStyle: "italic", margin: 0 }, text: `"${comment}"` }) : null, el("a", { class: "btn", href: "/gallery", text: "See our gallery" }))
  );
}

function renderForm(info) {
  let rating = 0;
  const faces = [];
  const rate = el("div", { class: "rate", role: "radiogroup", "aria-label": "Your rating" });
  for (let i = 1; i <= 5; i++) {
    const b = el("button", { type: "button", role: "radio", "aria-checked": "false", "aria-label": `${i} star${i > 1 ? "s" : ""}`, text: "★" });
    b.addEventListener("click", () => {
      rating = i;
      faces.forEach((f, k) => {
        f.classList.toggle("on", k < i);
        f.setAttribute("aria-checked", String(k + 1 === i));
      });
      err.textContent = "";
    });
    faces.push(b);
    rate.append(b);
  }
  const name = el("input", { name: "name", maxlength: "60", autocomplete: "name", value: info.booking.name });
  const comment = el("textarea", { name: "comment", maxlength: "1000", placeholder: "How was the craft, the colours, our service, delivery..." });
  const err = el("p", { class: "err", role: "alert" });
  const submit = el("button", { type: "submit", class: "btn primary block", text: "Submit review" });
  const form = el(
    "form",
    { class: "stack", novalidate: true },
    el("p", { style: { margin: 0 }, class: "center" }, `Namaskar ${info.booking.name}! You booked: `, el("strong", { text: info.booking.items.map((i) => i.title_en).join(", ") })),
    rate,
    el("label", { class: "field" }, "Your name (shown with your review)", name),
    el("label", { class: "field" }, el("span", {}, "Your review ", el("span", { class: "opt", text: "(optional)" })), comment),
    err,
    submit
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!rating) {
      err.textContent = "Please tap a star to rate us.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Sending…";
    try {
      await api(`/api/review/${encodeURIComponent(token)}`, { method: "POST", body: { rating, comment: comment.value.trim(), name: name.value.trim() } });
      thanks(rating, comment.value.trim());
    } catch (ex) {
      err.textContent = ex.message;
      if (ex instanceof ApiError && ex.status === 409) thanks(rating, comment.value.trim());
      submit.disabled = false;
      submit.textContent = "Submit review";
    }
  });
  box.replaceChildren(form);
}

(async function init() {
  chrome("");
  try {
    const info = await api(`/api/review/${encodeURIComponent(token)}`);
    if (info.already_reviewed) return thanks(info.review.rating, info.review.comment);
    if (info.cancelled) return message("এই বুকিংটি বাতিল করা হয়েছে।", "This booking was cancelled, so there is nothing to review.");
    if (!info.can_review) {
      return message(
        "আপনার অর্ডার হাতে পাওয়ার পর এখানে মতামত দিতে পারবেন।",
        `Hello ${info.booking.name}! You can review us here once you have received your order (booking ${info.booking.ref}). Please keep this link.`
      );
    }
    renderForm(info);
  } catch (err) {
    message("লিঙ্কটি সঠিক নয়।", err.message || "This review link is not valid.");
  }
})();
