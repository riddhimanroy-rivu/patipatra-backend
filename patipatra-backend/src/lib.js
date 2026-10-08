import { getSettings } from "./db.js";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const toBnDigits = (s) => String(s).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/** Settings that are safe to show to every visitor, with ready-made contact links. */
export function publicSettings(db) {
  const s = getSettings(db);
  const pct = String(s.advance_percent || "50");
  const phone = s.organiser_phone || "";
  return {
    organiser_name: s.organiser_name || "",
    organiser_phone: phone,
    call_url: `tel:+91${phone}`,
    whatsapp_url: `https://wa.me/91${phone}`,
    instagram_url: s.instagram_url || "",
    advance_percent: Number(pct),
    advance_message_en: String(s.advance_message_en || "").replaceAll("{percent}", pct),
    advance_message_bn: String(s.advance_message_bn || "").replaceAll("{percent}", toBnDigits(pct)),
    home_quote_bn: s.home_quote_bn || "",
  };
}

export function bookingItems(db, bookingId) {
  return db
    .prepare("SELECT service_id, service_title_en AS title_en, service_title_bn AS title_bn FROM booking_items WHERE booking_id=? ORDER BY id")
    .all(bookingId)
    .map((r) => ({ ...r }));
}

export const waLink = (phone10, text) => `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`;
