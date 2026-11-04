/**
 * Website content model.
 * Every public section reads from here. Admins edit these in /admin/content (per locale, draft →
 * publish → revisions). Anything not yet edited falls back to the defaults below, so the site
 * never renders empty. Defaults are English; Nepali rows override field by field.
 *
 * Copy rules (brand/BRAND_GUIDELINES.md §Voice): specific, warm, honest. No medical/nutrition
 * claims we can't back, no invented numbers, no fake reviews.
 */

export type FieldType = "text" | "textarea" | "markdown" | "image" | "url" | "boolean" | "number" | "list";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  fields?: Field[]; // for list items
  itemLabel?: string;
};

export type SectionDef = {
  key: string;
  label: string;
  group: string;
  description: string;
  fields: Field[];
  defaults: Record<string, unknown>;
};

const t = (name: string, label: string, help?: string): Field => ({ name, label, type: "text", help });
const ta = (name: string, label: string, help?: string): Field => ({ name, label, type: "textarea", help });
const url = (name: string, label: string): Field => ({ name, label, type: "url" });
const img = (name: string, label: string, help?: string): Field => ({ name, label, type: "image", help });
const intro = (key: string, label: string, group: string, d: { eyebrow: string; title: string; intro: string }): SectionDef => ({
  key,
  label,
  group,
  description: "Heading block at the top of the page.",
  fields: [t("eyebrow", "Small line above the title"), t("title", "Title"), ta("intro", "Intro paragraph")],
  defaults: d,
});

export const SECTIONS: SectionDef[] = [
  // ───────── Global ─────────
  {
    key: "announcement",
    label: "Announcement bar",
    group: "Global",
    description: "Thin strip above the header on every page. Timed promotions go in Banners.",
    fields: [{ name: "enabled", label: "Show the bar", type: "boolean" }, t("text", "Message"), t("linkLabel", "Link label"), url("linkHref", "Link URL")],
    defaults: {
      enabled: true,
      text: "Order by 9:30 AM for lunch the same day.",
      linkLabel: "See this week's menu",
      linkHref: "/menu",
    },
  },
  {
    key: "footer",
    label: "Footer",
    group: "Global",
    description: "Footer text.",
    fields: [ta("blurb", "Short description"), t("bottomNote", "Bottom line (graffiti style)")],
    defaults: {
      blurb: "A cloud kitchen in Kathmandu cooking home-style lunch every morning and delivering it to offices, shops, colleges, work sites and homes.",
      bottomNote: "Ghar ko swad, harek diuso.",
    },
  },

  // ───────── Home page blocks (order & visibility set in Admin → Page sections → Home layout) ─────────
  {
    key: "home.hero",
    label: "Hero",
    group: "Home page",
    description: "The first thing people see.",
    fields: [
      t("eyebrow", "Small line above headline"),
      t("headline", "Headline"),
      t("highlight", "Highlighted word(s)", "Shown in the hand-painted style after the headline."),
      ta("subhead", "Supporting text"),
      t("primaryLabel", "Main button label"),
      url("primaryHref", "Main button link"),
      t("secondaryLabel", "Second button label"),
      url("secondaryHref", "Second button link"),
      t("tertiaryLabel", "Text link label"),
      url("tertiaryHref", "Text link"),
      img("image", "Hero photo (optional)", "A real photo of your food. Leave empty to use the illustrated dabba."),
      t("imageAlt", "Photo description (alt text)"),
      { name: "points", label: "Quick points", type: "list", itemLabel: "Point", fields: [t("text", "Text")] },
    ],
    defaults: {
      eyebrow: "Lunch delivery · Kathmandu",
      headline: "Home-style lunch,",
      highlight: "wherever you work.",
      subhead:
        "A new dabba every day of the week — dal bhat, choila rolls, noodles and more — cooked each morning and delivered at lunchtime to your office, shop, college or home.",
      primaryLabel: "See this week's menu",
      primaryHref: "/menu",
      secondaryLabel: "Build my week",
      secondaryHref: "/plans",
      tertiaryLabel: "Lunch for your team",
      tertiaryHref: "/corporate",
      image: "",
      imageAlt: "",
      points: [{ text: "Order by 9:30 AM for same-day lunch" }, { text: "A vegetarian option every day" }, { text: "Skip or pause before the cut-off" }],
    },
  },
  {
    key: "home.how",
    label: "How it works",
    group: "Home page",
    description: "Three or four steps explaining ordering.",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), { name: "steps", label: "Steps", type: "list", itemLabel: "Step", fields: [t("title", "Title"), ta("text", "Text")] }],
    defaults: {
      eyebrow: "How it works",
      title: "Lunch sorted in three steps",
      steps: [
        { title: "Pick your days", text: "Order one lunch, a few days, or plan the whole week or month. Each delivery day is its own order." },
        { title: "Choose the dabba", text: "Take the chef's pick for the day, the vegetarian option, or build your own from the day's dishes." },
        { title: "We bring it at lunch", text: "Cooked in the morning and delivered in your chosen window. Change or skip until 9:30 AM that day." },
      ],
    },
  },
  {
    key: "home.week",
    label: "This week's menu",
    group: "Home page",
    description: "Heading for the live weekly menu strip (the dishes come from Weekly menus).",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), ta("intro", "Intro"), t("linkLabel", "Link label")],
    defaults: {
      eyebrow: "On the menu",
      title: "This week, day by day",
      intro: "The menu changes every week. Each day has the chef's pick and at least one vegetarian option.",
      linkLabel: "Full menu with allergens",
    },
  },
  {
    key: "home.build",
    label: "Build-a-Dabba teaser",
    group: "Home page",
    description: "Promotes the build-your-own dabba.",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), ta("text", "Text"), t("buttonLabel", "Button label")],
    defaults: {
      eyebrow: "Your lunch, your way",
      title: "Build your own dabba",
      text: "Start with rice, roti, chiura or noodles, add a curry or choila, a vegetable, achar and extras. You see the price and allergens as you go.",
      buttonLabel: "Build a dabba",
    },
  },
  {
    key: "home.plans",
    label: "Plans teaser",
    group: "Home page",
    description: "Heading over the plan cards (plans come from the Plan catalogue).",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), ta("intro", "Intro")],
    defaults: {
      eyebrow: "Plans",
      title: "Plan a week or a month",
      intro: "Plans are counted in real delivery days — public holidays and kitchen closures are left out, and you aren't charged for them.",
    },
  },
  {
    key: "home.coverage",
    label: "Delivery areas teaser",
    group: "Home page",
    description: "Invites people to check their area.",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), ta("text", "Text"), t("buttonLabel", "Button label")],
    defaults: {
      eyebrow: "Where we deliver",
      title: "Is your area on our route?",
      text: "We're starting with central Kathmandu and adding areas as our riders' routes grow. Search your tole or locality to see the delivery fee and lunch window.",
      buttonLabel: "Check my area",
    },
  },
  {
    key: "home.teams",
    label: "Teams band",
    group: "Home page",
    description: "Dark band selling team / office lunches.",
    fields: [
      t("eyebrow", "Small line"),
      t("title", "Title"),
      ta("text", "Text"),
      { name: "points", label: "Points", type: "list", itemLabel: "Point", fields: [t("text", "Text")] },
      t("buttonLabel", "Button label"),
    ],
    defaults: {
      eyebrow: "For teams",
      title: "Feed your whole team, one invoice a month",
      text: "Offices, shops and project sites can pay for staff lunch, let staff pay themselves, or split it. Everyone picks their own dabba; we deliver together.",
      points: [{ text: "Company-paid, employee-paid or split" }, { text: "Monthly VAT invoice with PAN details" }, { text: "Mixed veg and non-veg orders" }, { text: "Free tasting for new teams" }],
      buttonLabel: "Talk to us about your team",
    },
  },
  {
    key: "home.faq",
    label: "FAQ teaser",
    group: "Home page",
    description: "Shows a few FAQs (from the FAQ list).",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), { name: "count", label: "How many questions", type: "number" }],
    defaults: { eyebrow: "Questions", title: "Before you order", count: 5 },
  },
  {
    key: "home.cta",
    label: "Closing call to action",
    group: "Home page",
    description: "Last block before the footer.",
    fields: [t("title", "Title"), ta("text", "Text"), t("buttonLabel", "Button label"), url("buttonHref", "Button link")],
    defaults: {
      title: "Tomorrow's lunch, sorted today.",
      text: "Pick a day, pick a dabba. It takes about a minute.",
      buttonLabel: "Order lunch",
      buttonHref: "/menu",
    },
  },

  // ───────── Page intros ─────────
  intro("menu.intro", "Menu page intro", "Menu", {
    eyebrow: "Weekly menu",
    title: "What's cooking this week",
    intro: "Every day has a chef's pick and a vegetarian option. Tap a dabba for its full contents and allergens.",
  }),
  intro("build.intro", "Build-a-Dabba intro", "Menu", {
    eyebrow: "Build a dabba",
    title: "Put together your own lunch",
    intro: "Choose a base, a main and the sides you like. The price, diet and allergens update as you pick.",
  }),
  intro("plans.intro", "Plans page intro", "Plans", {
    eyebrow: "Meal plans",
    title: "Lunch for the week or the month",
    intro: "Choose the days you want, follow the chef's rotation or pick each day yourself. Skip or pause before 9:30 AM on the day.",
  }),
  intro("coverage.intro", "Delivery areas intro", "Delivery", {
    eyebrow: "Delivery areas",
    title: "Where we deliver lunch",
    intro: "We deliver to any address inside these areas — office, shop, college, work site or home. Type your locality to check.",
  }),
  intro("corporate.intro", "Teams page intro", "Teams", {
    eyebrow: "For teams",
    title: "Lunch for your team, without the admin",
    intro: "From a 10-person office to a 200-person site: everyone orders their own dabba, we deliver to one hand-off point, and you get one monthly invoice.",
  }),
  {
    key: "corporate.billing",
    label: "Teams: who pays",
    group: "Teams",
    description: "Explains employer-paid, employee-paid and split billing.",
    fields: [t("title", "Title"), { name: "options", label: "Options", type: "list", itemLabel: "Option", fields: [t("title", "Title"), ta("text", "Text")] }],
    defaults: {
      title: "You decide who pays",
      options: [
        { title: "Company pays", text: "Staff order freely within a monthly allowance you set. You get one invoice at the end of the month." },
        { title: "Staff pay", text: "Your team gets the company discount and free delivery; each person pays for their own lunch." },
        { title: "Split", text: "You cover a share — for example half of each lunch up to a limit — and staff pay the rest." },
      ],
    },
  },
  {
    key: "corporate.steps",
    label: "Teams: getting started",
    group: "Teams",
    description: "Onboarding steps.",
    fields: [t("title", "Title"), { name: "steps", label: "Steps", type: "list", itemLabel: "Step", fields: [t("title", "Title"), ta("text", "Text")] }],
    defaults: {
      title: "Getting started",
      steps: [
        { title: "Tell us about your team", text: "Headcount, location and how you'd like to pay." },
        { title: "Free tasting", text: "We bring a tasting lunch for a few people so your team can try before you commit." },
        { title: "Invite your team", text: "Share a join code or upload a list. Admins approve members and see everyone's orders." },
        { title: "Lunch arrives", text: "We deliver together to your reception or site office in the lunch window you choose." },
      ],
    },
  },
  {
    key: "about.story",
    label: "About: our story",
    group: "About",
    description: "The kitchen story.",
    fields: [t("eyebrow", "Small line"), t("title", "Title"), { name: "body", label: "Story", type: "markdown" }, img("image", "Kitchen photo (optional)"), t("imageAlt", "Photo description")],
    defaults: {
      eyebrow: "Our kitchen",
      title: "Why a dabba?",
      body:
        "In Mumbai, dabbawalas have carried home-cooked lunch to workers for more than a century. We liked the idea of lunch that tastes like home, arriving on time, wherever you are.\n\nDabba Bela is that idea for Kathmandu. We cook a short menu each morning in one kitchen, rotate it every week so it never gets boring, and deliver it at lunchtime — *bela* — to offices, shops, colleges, work sites and homes.\n\nWe keep the menu short on purpose. It lets us buy fresh every morning, batch-cook carefully and keep prices fair.",
      image: "",
      imageAlt: "",
    },
  },
  {
    key: "about.process",
    label: "About: how we cook",
    group: "About",
    description: "Kitchen process steps. Only describe what you actually do.",
    fields: [t("title", "Title"), { name: "steps", label: "Steps", type: "list", itemLabel: "Step", fields: [t("title", "Title"), ta("text", "Text")] }],
    defaults: {
      title: "A morning in our kitchen",
      steps: [
        { title: "Early buying", text: "Vegetables are bought fresh each morning; dry goods come from regular suppliers." },
        { title: "Orders lock at 9:30", text: "After the cut-off we know exactly how many lunches to cook, so very little is wasted." },
        { title: "Cook, check, pack", text: "Each dish is cooked in batches, checked before packing, and every dabba is labelled with its contents and allergens." },
        { title: "Out by lunchtime", text: "Riders leave in time for your chosen delivery window, grouped by area." },
      ],
    },
  },
  intro("contact.intro", "Contact intro", "Contact", {
    eyebrow: "Contact",
    title: "Talk to us",
    intro: "Questions about an order, your area or lunch for your team? Send us a message and we'll reply on working days.",
  }),
  intro("faq.intro", "FAQ intro", "FAQ", {
    eyebrow: "FAQ",
    title: "Questions people ask",
    intro: "Can't find your answer? Write to us from the contact page.",
  }),
  intro("journal.intro", "Journal intro", "Journal", {
    eyebrow: "Journal",
    title: "Notes from the kitchen",
    intro: "Menus, sourcing and what we're learning as we cook.",
  }),
];

export const SECTION_MAP = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

// Store (draft / publish / revisions / locales) lives in ./cms-store.ts
export { getSection, getSections } from "./cms-store";
