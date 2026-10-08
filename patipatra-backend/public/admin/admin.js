import { api, ApiError, el, icon, toast, stars } from "/assets/site.js";

const app = document.getElementById("app");

const STATUSES = ["new", "contacted", "confirmed", "advance_received", "in_progress", "delivered", "completed", "cancelled"];
const STATUS_LABEL = {
  new: "New", contacted: "Contacted", confirmed: "Confirmed", advance_received: "Advance received",
  in_progress: "In progress", delivered: "Delivered", completed: "Completed", cancelled: "Cancelled",
  pending: "Waiting for approval", approved: "Approved", hidden: "Hidden",
};
const SETTING_FIELDS = [
  ["organiser_name", "Organiser name", "text"],
  ["organiser_phone", "Organiser phone (10 digits)", "tel"],
  ["instagram_url", "Instagram link", "url"],
  ["advance_percent", "Advance percentage", "number"],
  ["advance_message_en", "Advance message in English (use {percent} for the number)", "textarea"],
  ["advance_message_bn", "Advance message in Bengali (use {percent} for the number)", "textarea"],
  ["home_quote_bn", "Home page quote (Bengali)", "textarea"],
];

const state = { tab: "bookings", unread: 0, stats: null, sound: localStorage.getItem("pp_sound") === "1", es: null, audio: null, refreshBookings: null };

const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};
const badge = (s) => el("span", { class: "badge", dataset: { s }, text: STATUS_LABEL[s] || s });

/** API call that sends the admin back to the login screen if the session ended. */
async function adm(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && path !== "/api/admin/login") showLogin();
    throw err;
  }
}

async function uploadFile(file) {
  let res;
  try {
    res = await fetch(`/api/admin/upload?filename=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Upload failed. Please check your internet connection.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (res.status === 401) showLogin();
  if (!res.ok || !data?.ok) throw new ApiError(data?.error || "Upload failed.", { status: res.status });
  return data;
}

// ---------------------------------------------------------------- alerts
function beep() {
  try {
    state.audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audio;
    if (ctx.state === "suspended") ctx.resume();
    [0, 0.22].forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = delay ? 1040 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.22);
    });
  } catch {
    /* audio not available */
  }
}

function updateTitle() {
  document.title = state.unread ? `(${state.unread}) Patipatra Admin` : "Patipatra Admin";
}

function onLiveEvent(kind, d) {
  state.unread += 1;
  updateTitle();
  toast(`${d.title}${d.name ? " - " + d.name : ""}`, { ms: 9000 });
  if (state.sound) beep();
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try {
      new Notification(d.title, { body: String(d.body || "").slice(0, 140), tag: d.ref });
    } catch {
      /* some mobile browsers only allow service-worker notifications */
    }
  }
  refreshStats();
  if (kind === "booking" && state.tab === "bookings") state.refreshBookings?.();
  if (kind === "review" && state.tab === "reviews") showTab("reviews");
  drawBell();
}

function connectStream() {
  state.es?.close();
  const es = new EventSource("/api/admin/stream");
  state.es = es;
  es.addEventListener("booking", (e) => onLiveEvent("booking", JSON.parse(e.data)));
  es.addEventListener("review", (e) => onLiveEvent("review", JSON.parse(e.data)));
  es.onerror = async () => {
    if (es.readyState === EventSource.CLOSED) {
      try {
        await api("/api/admin/me");
        setTimeout(connectStream, 3000);
      } catch {
        showLogin();
      }
    }
  };
}

async function toggleAlerts() {
  state.sound = !state.sound;
  localStorage.setItem("pp_sound", state.sound ? "1" : "0");
  if (state.sound) {
    beep();
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
  }
  drawAlertBtn();
}

// ---------------------------------------------------------------- login
function showLogin() {
  state.es?.close();
  const err = el("p", { class: "err", role: "alert" });
  const pw = el("input", { type: "password", name: "password", autocomplete: "current-password", required: true, autofocus: true });
  const form = el(
    "form",
    { class: "card stack login" },
    el("div", { class: "center" }, el("span", { class: "logo", style: { display: "inline-block", background: "var(--red)" } }, el("img", { src: "/assets/patipatra-logo.png", alt: "" })), el("h1", { class: "bn", style: { margin: ".5rem 0 0", color: "var(--red)", fontWeight: 500 }, text: "পাটিপত্র" }), el("span", { class: "sc", text: "Admin panel" })),
    el("label", { class: "field" }, "Password", pw),
    err,
    el("button", { class: "btn primary block", type: "submit", text: "Log in" })
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    try {
      await api("/api/admin/login", { method: "POST", body: { password: pw.value } });
      start();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  app.replaceChildren(form);
  pw.focus();
}

// ---------------------------------------------------------------- shell
let tabsBox;
let panel;
let alertBtn;
let bellBtn;

function drawAlertBtn() {
  alertBtn.className = "btn small" + (state.sound ? " on" : "");
  alertBtn.textContent = state.sound ? "Sound alerts: ON" : "Turn on sound alerts";
}
function drawBell() {
  bellBtn.textContent = state.unread ? `Notifications (${state.unread})` : "Notifications";
}

async function refreshStats() {
  try {
    const d = await adm("/api/admin/stats");
    state.stats = d;
    state.unread = d.unread_notifications;
    updateTitle();
    drawTabs();
    drawBell();
  } catch {
    /* ignore */
  }
}

const TABS = [
  ["bookings", "Bookings"],
  ["services", "Items & collections"],
  ["gallery", "Gallery"],
  ["reviews", "Reviews"],
  ["settings", "Settings"],
];

function drawTabs() {
  tabsBox.replaceChildren(
    ...TABS.map(([id, label]) => {
      const n = id === "bookings" ? state.stats?.bookings?.new : id === "reviews" ? state.stats?.pending_reviews : 0;
      const b = el("button", { type: "button", role: "tab", "aria-selected": String(state.tab === id) }, label, n ? el("span", { class: "count", text: String(n) }) : null);
      b.addEventListener("click", () => showTab(id));
      return b;
    })
  );
}

function showTab(id) {
  state.tab = id;
  state.refreshBookings = null;
  drawTabs();
  panel.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
  const views = { bookings: viewBookings, services: viewServices, gallery: viewGallery, reviews: viewReviews, settings: viewSettings };
  views[id]().catch((err) => {
    if (err instanceof ApiError && err.status === 401) return;
    panel.replaceChildren(el("p", { class: "err", text: err.message }));
  });
}

async function start() {
  try {
    await api("/api/admin/me");
  } catch {
    return showLogin();
  }
  alertBtn = el("button", { type: "button", class: "btn small", onClick: toggleAlerts });
  bellBtn = el("button", { type: "button", class: "btn small", onClick: openNotifications });
  const out = el("button", {
    type: "button",
    class: "btn small",
    text: "Log out",
    onClick: async () => {
      await api("/api/admin/logout", { method: "POST", body: {} }).catch(() => {});
      showLogin();
    },
  });
  tabsBox = el("div", { class: "a-tabs", role: "tablist" });
  panel = el("div", { role: "tabpanel" });
  app.replaceChildren(
    el(
      "header",
      { class: "a-top" },
      el(
        "div",
        { class: "wrap in" },
        el("h1", {}, el("span", { class: "logo" }, el("img", { src: "/assets/patipatra-logo.png", alt: "" })), el("span", { class: "bn", text: "পাটিপত্র" }), " Admin"),
        el("div", { class: "row", style: { display: "flex", gap: ".5rem", flexWrap: "wrap" } }, bellBtn, alertBtn, el("a", { class: "btn small", href: "/booking", target: "_blank", rel: "noopener", text: "View website" }), out)
      )
    ),
    el("main", { class: "wrap", style: { paddingBottom: "4rem" } }, tabsBox, panel)
  );
  drawAlertBtn();
  drawBell();
  connectStream();
  await refreshStats();
  showTab(state.tab);
}

// resume audio on first tap/click (browsers require a gesture)
window.addEventListener("pointerdown", () => state.sound && state.audio?.state === "suspended" && state.audio.resume(), { once: false });

async function openNotifications() {
  const d = await adm("/api/admin/notifications");
  const dlg = el("dialog", { class: "dlg wide", "aria-label": "Notifications" });
  const close = el("button", { type: "button", class: "x", "aria-label": "Close", onClick: () => dlg.close() }, icon("x", 18));
  dlg.append(
    el("div", { class: "head" }, el("h2", { class: "bn", text: "নোটিফিকেশন" }), el("span", { class: "sc", text: "Notifications" }), close),
    el(
      "div",
      { class: "body" },
      el("div", { class: "nlist" }, d.items.length ? d.items.map((n) => el("div", { class: "nitem" + (n.is_read ? "" : " unread") }, el("strong", { text: n.title }), el("div", { class: "small muted", text: fmtTime(n.created_at) }), el("pre", { text: n.body }))) : el("p", { class: "muted", text: "No notifications yet." })),
      el("button", {
        type: "button",
        class: "btn small",
        text: "Mark all as read",
        onClick: async () => {
          await adm("/api/admin/notifications/read", { method: "POST", body: {} });
          state.unread = 0;
          updateTitle();
          drawBell();
          dlg.close();
          refreshStats();
        },
      })
    )
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- bookings
async function viewBookings() {
  const statusSel = el("select", { "aria-label": "Filter by status" }, el("option", { value: "", text: "All statuses" }), STATUSES.map((s) => el("option", { value: s, text: STATUS_LABEL[s] })));
  const search = el("input", { type: "search", placeholder: "Search name, phone or ID", "aria-label": "Search bookings" });
  const body = el("tbody");
  const info = el("p", { class: "muted small" });

  async function load() {
    const qs = new URLSearchParams();
    if (statusSel.value) qs.set("status", statusSel.value);
    if (search.value.trim()) qs.set("q", search.value.trim());
    const d = await adm(`/api/admin/bookings?${qs}`);
    info.textContent = `${d.total} booking${d.total === 1 ? "" : "s"}`;
    body.replaceChildren(
      ...(d.bookings.length
        ? d.bookings.map((b) =>
            el(
              "tr",
              { class: b.status === "new" ? "is-new" : "" },
              el("td", {}, el("button", { type: "button", class: "linkbtn", text: b.ref, onClick: () => openBooking(b.id) }), el("div", { class: "small muted", text: fmtTime(b.created_at) })),
              el("td", {}, el("strong", { text: b.name }), el("div", { class: "small", text: b.phone })),
              el("td", { text: b.items || "" }),
              el("td", { text: [b.event_date, b.city].filter(Boolean).join(" · ") || "-" }),
              el("td", {}, badge(b.status))
            )
          )
        : [el("tr", {}, el("td", { colspan: "5", class: "muted", text: "No bookings found." }))])
    );
  }
  state.refreshBookings = () => load().catch(() => {});
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load().catch((e) => toast(e.message, { error: true })), 300);
  });
  statusSel.addEventListener("change", () => load().catch((e) => toast(e.message, { error: true })));

  panel.replaceChildren(
    el("div", { class: "a-bar" }, statusSel, search, el("button", { type: "button", class: "btn small", text: "Refresh", onClick: () => load() }), info),
    el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ["Booking", "Customer", "Wants", "Event", "Status"].map((h) => el("th", { text: h })))), body))
  );
  await load();
}

async function openBooking(id) {
  const first = await adm(`/api/admin/bookings/${id}`);
  const dlg = el("dialog", { class: "dlg wide", "aria-label": "Booking details" });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);

  function draw(b) {
    const statusSel = el("select", { name: "status" }, STATUSES.map((s) => el("option", { value: s, text: STATUS_LABEL[s], selected: s === b.status })));
    const note = el("textarea", { name: "note", maxlength: "2000", placeholder: "Private notes: price talked about, colours, delivery date…" });
    note.value = b.admin_note || "";
    const err = el("p", { class: "err", role: "alert" });

    const save = el("button", {
      type: "button",
      class: "btn primary",
      text: "Save changes",
      onClick: async () => {
        err.textContent = "";
        try {
          const r = await adm(`/api/admin/bookings/${b.id}`, { method: "PATCH", body: { status: statusSel.value, admin_note: note.value } });
          toast("Booking updated");
          draw(r.booking);
          refreshStats();
          state.refreshBookings?.();
        } catch (ex) {
          err.textContent = ex.message;
        }
      },
    });

    let reviewBlock = null;
    if (b.review) {
      reviewBlock = el("div", { class: "card stack" }, el("strong", { text: "Customer review" }), stars(b.review.rating), b.review.comment ? el("div", { class: "pre", text: b.review.comment }) : null, badge(b.review.status));
    } else if (b.can_request_review) {
      reviewBlock = el(
        "div",
        { class: "card stack" },
        el("strong", { text: "Ask the customer for a review" }),
        el("p", { class: "small muted", style: { margin: 0 }, text: b.review_requested_at ? `Last asked: ${fmtTime(b.review_requested_at)}` : "The order is delivered. Send them the review link on WhatsApp." }),
        el("div", { class: "row" },
          el("a", {
            class: "btn green small",
            href: b.review_whatsapp_url,
            target: "_blank",
            rel: "noopener",
            onClick: () => adm(`/api/admin/bookings/${b.id}/review-request`, { method: "POST", body: {} }).catch(() => {}),
          }, icon("chat", 16), "Ask on WhatsApp"),
          el("button", {
            type: "button",
            class: "btn small",
            text: "Copy review link",
            onClick: async (e) => {
              try {
                await navigator.clipboard.writeText(b.review_url);
                e.target.textContent = "Copied!";
              } catch {
                e.target.textContent = b.review_url;
              }
            },
          })
        )
      );
    } else {
      reviewBlock = el("p", { class: "small muted", text: 'When you set the status to "Delivered", a review request button appears here.' });
    }

    dlg.replaceChildren(
      el("div", { class: "head" }, el("h2", { text: b.ref, style: { fontFamily: "inherit", fontSize: "1.4rem" } }), badge(b.status), " ", el("span", { class: "small muted", text: fmtTime(b.created_at) }), el("button", { type: "button", class: "x", "aria-label": "Close", onClick: () => dlg.close() }, icon("x", 18))),
      el(
        "div",
        { class: "body" },
        el(
          "dl",
          { class: "kv" },
          el("dt", { text: "Customer" }), el("dd", {}, el("strong", { text: b.name })),
          el("dt", { text: "Mobile" }), el("dd", { text: b.phone }),
          b.email ? [el("dt", { text: "Email" }), el("dd", { text: b.email })] : null,
          el("dt", { text: "Event" }), el("dd", { text: [b.event_date, b.city].filter(Boolean).join(" · ") || "Not given" }),
          el("dt", { text: "Wants" }), el("dd", {}, b.items.map((i) => el("div", {}, el("span", { class: "bn", text: i.title_bn }), ` · ${i.title_en}`)))
        ),
        el("div", { class: "row", style: { display: "flex", gap: ".6rem", flexWrap: "wrap" } },
          el("a", { class: "btn primary small", href: b.call_url }, icon("phone", 16), "Call customer"),
          el("a", { class: "btn green small", href: b.customer_whatsapp_url, target: "_blank", rel: "noopener" }, icon("chat", 16), "WhatsApp customer")
        ),
        b.message ? el("div", {}, el("div", { class: "sc muted", text: "Customer's message" }), el("div", { class: "pre", text: b.message })) : null,
        el("div", { class: "cols", style: { display: "grid", gap: ".8rem" } }, el("label", { class: "field" }, "Status", statusSel), el("label", { class: "field" }, "Private note", note)),
        err,
        el("div", { class: "row", style: { display: "flex", gap: ".6rem", flexWrap: "wrap" } }, save,
          el("button", {
            type: "button",
            class: "btn danger small",
            text: "Delete booking",
            onClick: async () => {
              if (!confirm(`Delete booking ${b.ref} permanently?`)) return;
              await adm(`/api/admin/bookings/${b.id}`, { method: "DELETE" });
              dlg.close();
              toast("Booking deleted");
              refreshStats();
              state.refreshBookings?.();
            },
          })
        ),
        reviewBlock
      )
    );
  }
  draw(first.booking);
  dlg.showModal();
}

// ---------------------------------------------------------------- services
function serviceEditor(s, reload) {
  const isNew = !s;
  const v = s || { title_bn: "", title_en: "", category: "", description: "", image_url: "", sort_order: 0, is_active: true, is_custom: false };
  const f = {
    title_bn: el("input", { name: "title_bn", value: v.title_bn, maxlength: "80", lang: "bn" }),
    title_en: el("input", { name: "title_en", value: v.title_en, maxlength: "80" }),
    category: el("input", { name: "category", value: v.category, maxlength: "60", list: "cats" }),
    sort_order: el("input", { name: "sort_order", type: "number", value: String(v.sort_order) }),
    image_url: el("input", { name: "image_url", value: v.image_url, maxlength: "500", placeholder: "Upload a photo or paste a link" }),
    description: el("textarea", { name: "description", maxlength: "400" }),
  };
  f.description.value = v.description;
  const active = el("input", { type: "checkbox", checked: !!v.is_active });
  const preview = el("img", { class: "thumb", alt: "", hidden: !v.image_url, src: v.image_url || null });
  const err = el("p", { class: "err", role: "alert" });
  const file = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", "aria-label": "Upload image" });
  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    err.textContent = "Uploading…";
    try {
      const up = await uploadFile(file.files[0]);
      f.image_url.value = up.url;
      preview.src = up.url;
      preview.hidden = false;
      err.textContent = "";
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  f.image_url.addEventListener("change", () => {
    preview.hidden = !f.image_url.value;
    if (f.image_url.value) preview.src = f.image_url.value;
  });

  const payload = () => ({
    title_bn: f.title_bn.value, title_en: f.title_en.value, category: f.category.value, description: f.description.value,
    image_url: f.image_url.value.trim(), sort_order: Number(f.sort_order.value || 0), is_active: active.checked ? 1 : 0,
  });
  const save = el("button", {
    type: "button",
    class: "btn primary small",
    text: isNew ? "Add item" : "Save",
    onClick: async () => {
      err.textContent = "";
      try {
        if (isNew) await adm("/api/admin/services", { method: "POST", body: payload() });
        else await adm(`/api/admin/services/${s.id}`, { method: "PATCH", body: payload() });
        toast(isNew ? "Item added" : "Saved");
        reload();
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  });
  const del = isNew || v.is_custom ? null : el("button", {
    type: "button",
    class: "btn danger small",
    text: "Delete",
    onClick: async () => {
      if (!confirm(`Delete "${v.title_en}"? Past bookings keep their record.`)) return;
      try {
        await adm(`/api/admin/services/${s.id}`, { method: "DELETE" });
        reload();
      } catch (ex) {
        err.textContent = ex.message;
      }
    },
  });
  return el(
    "div",
    { class: "a-card" },
    el("div", { class: "a-thumb-row" }, preview, el("div", { class: "stack", style: { flex: "1", minWidth: "220px" } }, el("label", { class: "field" }, "Photo", file), el("label", { class: "field" }, "…or image link", f.image_url))),
    el("div", { class: "cols" }, el("label", { class: "field" }, "Title (Bengali)", f.title_bn), el("label", { class: "field" }, "Title (English)", f.title_en), el("label", { class: "field" }, "Group", f.category), el("label", { class: "field" }, "Order", f.sort_order)),
    el("label", { class: "field" }, "Short description", f.description),
    err,
    el("div", { class: "row" }, el("label", { class: "row small", style: { display: "flex", gap: ".4rem", alignItems: "center" } }, active, "Show on website"), v.is_custom ? el("span", { class: "badge", text: "Custom-order option" }) : null, save, del)
  );
}

async function viewServices() {
  const d = await adm("/api/admin/services");
  const cats = el("datalist", { id: "cats" }, [...new Set(d.services.map((s) => s.category).filter(Boolean))].map((c) => el("option", { value: c })));
  const reload = () => showTab("services");
  panel.replaceChildren(
    cats,
    el("p", { class: "muted small", text: "These are the items customers can pick on the booking page. Lower order numbers appear first." }),
    el("h2", { text: "Add a new item", style: { fontSize: "1.1rem" } }),
    serviceEditor(null, reload),
    el("h2", { text: "Existing items", style: { fontSize: "1.1rem", marginTop: "2rem" } }),
    el("div", { class: "a-list" }, d.services.map((s) => serviceEditor(s, reload)))
  );
}

// ---------------------------------------------------------------- gallery
async function viewGallery() {
  const [g, sv] = await Promise.all([adm("/api/admin/gallery"), adm("/api/admin/services")]);
  const svcOptions = (selected) => [el("option", { value: "", text: "- no item -" }), ...sv.services.map((s) => el("option", { value: String(s.id), text: s.title_en, selected: s.id === selected }))];

  const files = el("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" });
  const title = el("input", { maxlength: "120", placeholder: "Optional title" });
  const svc = el("select", {}, svcOptions(null));
  const status = el("p", { class: "small muted", role: "status" });
  const up = el("button", {
    type: "button",
    class: "btn primary",
    text: "Upload",
    onClick: async () => {
      const list = [...files.files];
      if (!list.length) return (status.textContent = "Choose one or more photos or videos first.");
      up.disabled = true;
      let done = 0;
      for (const file of list) {
        status.textContent = `Uploading ${done + 1} of ${list.length}: ${file.name}…`;
        try {
          const r = await uploadFile(file);
          await adm("/api/admin/gallery", { method: "POST", body: { kind: r.kind, url: r.url, title: title.value, service_id: svc.value || null } });
          done++;
        } catch (ex) {
          status.textContent = `${file.name}: ${ex.message}`;
          up.disabled = false;
          return;
        }
      }
      toast(`${done} file${done === 1 ? "" : "s"} added to the gallery`);
      showTab("gallery");
    },
  });

  const cards = g.items.map((it) => {
    const t = el("input", { value: it.title, maxlength: "120", "aria-label": "Title" });
    const s = el("select", { "aria-label": "Item" }, svcOptions(it.service_id));
    const act = el("input", { type: "checkbox", checked: !!it.is_active });
    const ord = el("input", { type: "number", value: String(it.sort_order), "aria-label": "Order" });
    const err = el("p", { class: "err" });
    const media = it.kind === "video" ? el("video", { class: "thumb", src: `${it.url}#t=0.5`, preload: "metadata", muted: true }) : el("img", { class: "thumb", src: it.url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    return el(
      "div",
      { class: "a-card" },
      el("div", { class: "a-thumb-row" }, media, el("div", { class: "stack", style: { flex: "1", minWidth: "200px" } }, el("span", { class: "badge", text: it.kind === "video" ? "Video" : "Photo" }), el("label", { class: "field" }, "Title", t), el("label", { class: "field" }, "Item", s), el("label", { class: "field" }, "Order", ord))),
      err,
      el("div", { class: "row" },
        el("label", { class: "row small", style: { display: "flex", gap: ".4rem", alignItems: "center" } }, act, "Show on website"),
        el("button", {
          type: "button", class: "btn primary small", text: "Save",
          onClick: async () => {
            try {
              await adm(`/api/admin/gallery/${it.id}`, { method: "PATCH", body: { title: t.value, service_id: s.value || null, sort_order: Number(ord.value || 0), is_active: act.checked ? 1 : 0 } });
              toast("Saved");
            } catch (ex) {
              err.textContent = ex.message;
            }
          },
        }),
        el("button", {
          type: "button", class: "btn danger small", text: "Delete",
          onClick: async () => {
            if (!confirm("Remove this from the gallery?")) return;
            await adm(`/api/admin/gallery/${it.id}`, { method: "DELETE" });
            showTab("gallery");
          },
        })
      )
    );
  });

  panel.replaceChildren(
    el("div", { class: "a-card" }, el("h2", { text: "Add photos or videos", style: { fontSize: "1.1rem", margin: 0 } }), el("p", { class: "small muted", style: { margin: 0 }, text: "Photos up to 15 MB. Videos (MP4, WEBM, MOV) up to 150 MB." }), el("label", { class: "field" }, "Files", files), el("div", { class: "cols" }, el("label", { class: "field" }, "Title", title), el("label", { class: "field" }, "Item", svc)), status, el("div", {}, up)),
    el("h2", { text: `In the gallery (${g.items.length})`, style: { fontSize: "1.1rem", marginTop: "2rem" } }),
    g.items.some((i) => /sample/i.test(i.title)) ? el("p", { class: "small", style: { color: "#8a5a00" }, text: 'Items titled "Sample photo" are placeholders. Delete them once you have added your own work.' }) : null,
    el("div", { class: "a-list" }, cards)
  );
}

// ---------------------------------------------------------------- reviews
async function viewReviews() {
  const d = await adm("/api/admin/reviews");
  const set = async (id, status) => {
    await adm(`/api/admin/reviews/${id}`, { method: "PATCH", body: { status } });
    refreshStats();
    showTab("reviews");
  };
  panel.replaceChildren(
    d.reviews.length
      ? el("div", { class: "a-list" }, d.reviews.map((r) =>
          el("div", { class: "a-card" },
            el("div", { class: "row" }, stars(r.rating), badge(r.status), el("span", { class: "small muted", text: `${r.name} · booking ${r.ref} · ${fmtTime(r.created_at)}` })),
            r.comment ? el("div", { class: "pre", text: r.comment }) : el("p", { class: "muted small", text: "(no written comment)" }),
            el("div", { class: "row" },
              r.status !== "approved" ? el("button", { type: "button", class: "btn green small", text: "Show on website", onClick: () => set(r.id, "approved") }) : null,
              r.status !== "hidden" ? el("button", { type: "button", class: "btn small", text: "Hide", onClick: () => set(r.id, "hidden") }) : null,
              el("button", { type: "button", class: "btn danger small", text: "Delete", onClick: async () => { if (!confirm("Delete this review?")) return; await adm(`/api/admin/reviews/${r.id}`, { method: "DELETE" }); refreshStats(); showTab("reviews"); } })
            )
          )
        ))
      : el("div", { class: "empty", text: "No reviews yet. After you mark a booking as Delivered, use the “Ask on WhatsApp” button inside the booking." })
  );
}

// ---------------------------------------------------------------- settings
async function viewSettings() {
  const d = await adm("/api/admin/settings");
  const inputs = {};
  const err = el("p", { class: "err", role: "alert" });
  const fields = SETTING_FIELDS.map(([key, label, type]) => {
    const input = type === "textarea" ? el("textarea", { name: key, maxlength: "400" }) : el("input", { name: key, type, maxlength: "200" });
    input.value = d.settings[key] ?? "";
    inputs[key] = input;
    return el("label", { class: "field" }, label, input);
  });
  panel.replaceChildren(
    el(
      "div",
      { class: "a-card", style: { maxWidth: "640px" } },
      ...fields,
      err,
      el("div", {}, el("button", {
        type: "button",
        class: "btn primary",
        text: "Save settings",
        onClick: async () => {
          err.textContent = "";
          try {
            const body = {};
            for (const [k, input] of Object.entries(inputs)) body[k] = input.value;
            await adm("/api/admin/settings", { method: "PUT", body });
            toast("Settings saved");
          } catch (ex) {
            err.textContent = ex.message;
          }
        },
      }))
    ),
    el("div", { class: "a-card", style: { maxWidth: "640px", marginTop: "1.2rem" } },
      el("strong", { text: "Get alerts on your phone, even when this page is closed" }),
      el("p", { class: "small muted", style: { margin: 0 }, text: "This panel plays a sound and shows a pop-up only while it is open in a browser. For instant phone alerts at any time, add a free Telegram bot: put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the server's .env file (see README) and restart the server." })
    )
  );
}

start();
