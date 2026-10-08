// Default content. Titles, Bengali names, categories and descriptions are taken from the
// website design (Wedding_Decor_UI_Design). "Totto" (#11) is new and "anything else" is #12.
// Everything here can be edited later from the admin panel.

const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=85`;

export const SERVICES = [
  {
    slug: "kalka", title_bn: "কলকা", title_en: "Kalka", category: "Ritual craft",
    description: "Ornamental Bengali motifs, hand-painted for your celebration.",
    image_url: U("1771769076330-c424547f5c1c"),
  },
  {
    slug: "gachkouto", title_bn: "গাছকৌটো", title_en: "Gachkouto", category: "Ritual craft",
    description: "Traditional ceremonial craft, finished with delicate detailing.",
    image_url: U("1680491026542-a99730a0e235"),
  },
  {
    slug: "pan-pata", title_bn: "পান পাতা", title_en: "Paan Pata", category: "Ritual craft",
    description: "Decorated betel leaves composed for auspicious wedding rituals.",
    image_url: U("1705475388142-a2700c4caeb5"),
  },
  {
    slug: "boron-khai-daan", title_bn: "বরণ ও খই দান", title_en: "Boron & Khai Daan", category: "Wedding essentials",
    description: "A thoughtfully decorated set for welcoming and sacred offerings.",
    image_url: U("1670576980747-5dbb2623dc96"),
  },
  {
    slug: "kulo", title_bn: "কুলো", title_en: "Decorated Kulo", category: "Wedding essentials",
    description: "Hand-painted and adorned winnowing trays for every ritual moment.",
    image_url: U("1645257236324-9f431c6f3120"),
  },
  {
    slug: "biyer-piri", title_bn: "বিয়ের পিঁড়ি", title_en: "Biyer Piri", category: "Wedding essentials",
    description: "Wedding stools illustrated by hand with your chosen story and palette.",
    image_url: U("1729237261107-6fc4279f6d1c"),
  },
  {
    slug: "matir-thala", title_bn: "মাটির থালা", title_en: "Matir Thala", category: "Wedding essentials",
    description: "Earthy clay plates elevated with painted Bengali folk ornament.",
    image_url: U("1699764681875-dd04ce36b1c3"),
  },
  {
    slug: "mehendi", title_bn: "মেহেদি", title_en: "Mehendi Art", category: "Art & keepsakes",
    description: "Personal mehendi artistry shaped around your wedding story.",
    image_url: U("1734112679709-d0798e79f37f"),
  },
  {
    slug: "resin-memories", title_bn: "স্মৃতি সংরক্ষণ", title_en: "Resin Memories", category: "Art & keepsakes",
    description: "Your most precious wedding flowers and mementos, preserved in resin.",
    image_url: U("1607512566084-a20ed291d623"),
  },
  {
    slug: "artistic-panjabi", title_bn: "হাতে আঁকা পাঞ্জাবি", title_en: "Artistic Panjabi", category: "Wearable art",
    description: "Hand-painted shirts and Panjabis made as one-of-one wearable pieces.",
    image_url: U("1647949940712-bfcf82015d9b"),
  },
  {
    slug: "totto", title_bn: "তত্ত্ব", title_en: "Totto", category: "Wedding essentials",
    description: "Beautifully arranged totto — the gifts and hampers exchanged between the two families — styled to your tradition.",
    image_url: "",
  },
  {
    slug: "custom", title_bn: "আপনার পছন্দমতো", title_en: "Anything Else You Imagine", category: "Custom orders",
    description: "Have something else in mind? Tell us your idea and we will create it.",
    image_url: U("1587271407850-8d438ca9fdf2"),
    is_custom: 1,
  },
];

export const DEFAULT_SETTINGS = {
  organiser_name: "Mr. Amit Roy",
  organiser_phone: "9831090796",
  instagram_url: "https://www.instagram.com/_patipatra_",
  advance_percent: "50",
  advance_message_en:
    "To confirm your booking you have to pay {percent}% in advance. The remaining amount is taken after the work is completed.",
  advance_message_bn:
    "আপনার বুকিং নিশ্চিত করতে {percent}% অগ্রিম দিতে হবে। বাকি টাকা কাজ সম্পন্ন হওয়ার পরে নেওয়া হবে।",
  home_quote_bn: "আপনাদের শুভ অনুষ্ঠানকে আরও সুন্দর করে তোলার দায়িত্ব আমাদের",
};

// Sample gallery entries (stock photos from the design). Replace them with your own work.
export const DEMO_GALLERY = [
  ["1587271407850-8d438ca9fdf2", "custom"],
  ["1771769076330-c424547f5c1c", "kalka"],
  ["1645257236324-9f431c6f3120", "kulo"],
  ["1670576980747-5dbb2623dc96", "boron-khai-daan"],
  ["1729237261107-6fc4279f6d1c", "biyer-piri"],
  ["1734112679709-d0798e79f37f", "mehendi"],
];

export const BOOKING_STATUSES = [
  "new",
  "contacted",
  "confirmed",
  "advance_received",
  "in_progress",
  "delivered",
  "completed",
  "cancelled",
];

// Customers may leave a review once the order has reached one of these stages.
export const REVIEWABLE_STATUSES = ["delivered", "completed"];

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
