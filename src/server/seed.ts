/* Catalogue + demo seed. Shared by `prisma/seed.ts` and the one-time /setup screen. No "server-only" here. */
import type { Diet, ItemCategory, PrismaClient, StockUnit, Weekday, Role } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { addDays, dateOnly, todayKTM, weekStartOf } from "../lib/dates";

const R = (rupees: number) => Math.round(rupees * 100); // paisa

// ───────────── reference data ─────────────

const ALLERGENS = [
  ["GLUTEN", "Gluten (wheat)", "ग्लुटेन (गहुँ)"],
  ["DAIRY", "Milk & dairy", "दूध र दुग्ध पदार्थ"],
  ["EGG", "Egg", "अण्डा"],
  ["SOY", "Soy", "भटमास"],
  ["PEANUT", "Peanut", "बदाम"],
  ["TREE_NUT", "Tree nuts", "काजु/ओखर"],
  ["SESAME", "Sesame", "तिल"],
  ["MUSTARD", "Mustard", "तोरी/रायो"],
  ["FISH", "Fish", "माछा"],
  ["SHELLFISH", "Shellfish", "झिंगे माछा"],
] as const;

type Ing = { key: string; name: string; ne?: string; unit: StockUnit; cost: number; safety: number; reorder: number; allergens?: string[]; supplier?: "kalimati" | "meat" | "dry" };
const INGREDIENTS: Ing[] = [
  { key: "rice", name: "Rice (sona mansuli)", ne: "चामल", unit: "KG", cost: R(95), safety: 25, reorder: 50, supplier: "dry" },
  { key: "basmati", name: "Rice (basmati)", ne: "बासमती चामल", unit: "KG", cost: R(160), safety: 10, reorder: 25, supplier: "dry" },
  { key: "masdal", name: "Black lentil (mas)", ne: "मासको दाल", unit: "KG", cost: R(210), safety: 5, reorder: 10, supplier: "dry" },
  { key: "moong", name: "Moong dal", ne: "मुगी", unit: "KG", cost: R(180), safety: 5, reorder: 10, supplier: "dry" },
  { key: "rajma", name: "Rajma (kidney beans)", ne: "राज्मा", unit: "KG", cost: R(240), safety: 4, reorder: 10, supplier: "dry" },
  { key: "atta", name: "Whole-wheat atta", ne: "आटा", unit: "KG", cost: R(85), safety: 10, reorder: 25, allergens: ["GLUTEN"], supplier: "dry" },
  { key: "maida", name: "Refined flour (maida)", ne: "मैदा", unit: "KG", cost: R(80), safety: 5, reorder: 15, allergens: ["GLUTEN"], supplier: "dry" },
  { key: "noodles", name: "Egg-free wheat noodles", ne: "चाउचाउ", unit: "KG", cost: R(180), safety: 4, reorder: 10, allergens: ["GLUTEN"], supplier: "dry" },
  { key: "penne", name: "Penne pasta", unit: "KG", cost: R(380), safety: 2, reorder: 5, allergens: ["GLUTEN"], supplier: "dry" },
  { key: "chiura", name: "Beaten rice (chiura)", ne: "चिउरा", unit: "KG", cost: R(120), safety: 3, reorder: 8, supplier: "dry" },
  { key: "soybean", name: "Soybean (bhatmas)", ne: "भटमास", unit: "KG", cost: R(220), safety: 3, reorder: 8, allergens: ["SOY"], supplier: "dry" },
  { key: "chicken", name: "Chicken (boneless)", ne: "कुखुराको मासु", unit: "KG", cost: R(560), safety: 8, reorder: 20, supplier: "meat" },
  { key: "eggs", name: "Eggs", ne: "अण्डा", unit: "PC", cost: R(17), safety: 60, reorder: 180, allergens: ["EGG"], supplier: "meat" },
  { key: "paneer", name: "Paneer", ne: "पनिर", unit: "KG", cost: R(900), safety: 2, reorder: 5, allergens: ["DAIRY"], supplier: "meat" },
  { key: "dahi", name: "Dahi (curd)", ne: "दही", unit: "L", cost: R(180), safety: 5, reorder: 15, allergens: ["DAIRY"], supplier: "meat" },
  { key: "cream", name: "Cooking cream", unit: "L", cost: R(520), safety: 1, reorder: 4, allergens: ["DAIRY"], supplier: "meat" },
  { key: "mushroom", name: "Button mushroom", ne: "च्याउ", unit: "KG", cost: R(320), safety: 3, reorder: 8, supplier: "kalimati" },
  { key: "potato", name: "Potato", ne: "आलु", unit: "KG", cost: R(60), safety: 15, reorder: 40, supplier: "kalimati" },
  { key: "cauli", name: "Cauliflower", ne: "काउली", unit: "KG", cost: R(90), safety: 5, reorder: 15, supplier: "kalimati" },
  { key: "cabbage", name: "Cabbage", ne: "बन्दा", unit: "KG", cost: R(50), safety: 5, reorder: 15, supplier: "kalimati" },
  { key: "carrot", name: "Carrot", ne: "गाजर", unit: "KG", cost: R(80), safety: 4, reorder: 10, supplier: "kalimati" },
  { key: "rayo", name: "Rayo saag", ne: "रायोको साग", unit: "KG", cost: R(70), safety: 4, reorder: 10, supplier: "kalimati" },
  { key: "onion", name: "Onion", ne: "प्याज", unit: "KG", cost: R(90), safety: 10, reorder: 25, supplier: "kalimati" },
  { key: "garlic", name: "Garlic", ne: "लसुन", unit: "KG", cost: R(300), safety: 2, reorder: 5, supplier: "kalimati" },
  { key: "ginger", name: "Ginger", ne: "अदुवा", unit: "KG", cost: R(200), safety: 1, reorder: 3, supplier: "kalimati" },
  { key: "tomato", name: "Tomato", ne: "गोलभेडा", unit: "KG", cost: R(80), safety: 6, reorder: 15, supplier: "kalimati" },
  { key: "cucumber", name: "Cucumber", ne: "काँक्रो", unit: "KG", cost: R(60), safety: 3, reorder: 8, supplier: "kalimati" },
  { key: "radish", name: "Radish", ne: "मुला", unit: "KG", cost: R(40), safety: 3, reorder: 8, supplier: "kalimati" },
  { key: "gundruk", name: "Dried gundruk", ne: "गुन्द्रुक", unit: "KG", cost: R(600), safety: 1, reorder: 3, supplier: "dry" },
  { key: "mustardoil", name: "Mustard oil", ne: "तोरीको तेल", unit: "L", cost: R(320), safety: 5, reorder: 15, allergens: ["MUSTARD"], supplier: "dry" },
  { key: "veoil", name: "Sunflower oil", ne: "तेल", unit: "L", cost: R(280), safety: 8, reorder: 20, supplier: "dry" },
  { key: "ghee", name: "Ghee", ne: "घ्यू", unit: "KG", cost: R(1200), safety: 1, reorder: 3, allergens: ["DAIRY"], supplier: "dry" },
  { key: "spices", name: "Spice mix (house)", ne: "मसला", unit: "KG", cost: R(900), safety: 1, reorder: 3, supplier: "dry" },
  { key: "timur", name: "Timur (Sichuan pepper)", ne: "टिमुर", unit: "KG", cost: R(2200), safety: 0.3, reorder: 1, supplier: "dry" },
  { key: "sesame", name: "Sesame seeds", ne: "तिल", unit: "KG", cost: R(450), safety: 0.5, reorder: 2, allergens: ["SESAME"], supplier: "dry" },
  { key: "soysauce", name: "Soy sauce", unit: "L", cost: R(350), safety: 1, reorder: 3, allergens: ["SOY", "GLUTEN"], supplier: "dry" },
  { key: "fruit", name: "Seasonal fruit", ne: "फलफूल", unit: "KG", cost: R(180), safety: 3, reorder: 8, supplier: "kalimati" },
  { key: "box", name: "3-compartment dabba (disposable kraft)", unit: "PC", cost: R(18), safety: 200, reorder: 600, supplier: "dry" },
];

type Dish = {
  key: string;
  name: string;
  ne?: string;
  cat: ItemCategory;
  diet: Diet;
  verified?: boolean;
  price: number;
  spice?: number;
  station: string;
  prep?: number;
  portion?: string;
  desc?: string;
  custom?: boolean;
  noOG?: boolean;
  mayContain?: string[];
  limit?: number;
  // recipe for `yield` portions: [ingredientKey, qty, wastePct?]
  yield: number;
  bom: [string, number, number?][];
};

const DISHES: Dish[] = [
  { key: "rice", name: "Steamed rice", ne: "भात", cat: "BASE", diet: "VEGAN", verified: true, price: 40, station: "Dal & rice", portion: "1 bowl (≈250 g cooked)", desc: "Sona mansuli rice, cooked fresh each morning.", noOG: true, yield: 10, bom: [["rice", 1.1]] },
  { key: "jeera", name: "Jeera rice", ne: "जिरा भात", cat: "BASE", diet: "VEG", price: 55, station: "Dal & rice", portion: "1 bowl", yield: 10, bom: [["basmati", 1.1], ["ghee", 0.05], ["spices", 0.02]] },
  { key: "chiura", name: "Chiura (beaten rice)", ne: "चिउरा", cat: "BASE", diet: "VEGAN", verified: true, price: 35, station: "Cold & khaja", desc: "Light and crunchy — the Newari khaja base.", noOG: true, yield: 10, bom: [["chiura", 0.8]] },
  { key: "roti", name: "Whole-wheat roti ×2", ne: "रोटी", cat: "BASE", diet: "VEG", price: 40, station: "Tawa", yield: 10, bom: [["atta", 0.9], ["ghee", 0.03]] },
  { key: "garlicnoodle", name: "Garlic veggie noodles", ne: "लसुन चाउचाउ", cat: "MAIN", diet: "VEGAN", price: 110, station: "Wok", prep: 12, desc: "Wok-tossed with garlic, cabbage, carrot and spring onion.", yield: 10, bom: [["noodles", 1.2], ["cabbage", 0.6, 10], ["carrot", 0.4, 10], ["garlic", 0.12, 15], ["soysauce", 0.08], ["veoil", 0.12]] },
  { key: "chxfried", name: "Chicken fried rice", ne: "कुखुराको फ्राइड राइस", cat: "MAIN", diet: "CHICKEN", verified: true, price: 140, station: "Wok", prep: 12, portion: "1 box (≈90 g chicken)", desc: "Day-old rice done right, with a weighed chicken portion.", mayContain: ["EGG"], yield: 10, bom: [["rice", 0.9], ["chicken", 0.9, 5], ["onion", 0.3, 10], ["carrot", 0.3, 10], ["soysauce", 0.08], ["veoil", 0.15]] },
  { key: "vegfried", name: "Veg fried rice", ne: "भेज फ्राइड राइस", cat: "MAIN", diet: "VEGAN", price: 100, station: "Wok", prep: 12, yield: 10, bom: [["rice", 1.0], ["cabbage", 0.5, 10], ["carrot", 0.4, 10], ["onion", 0.3, 10], ["soysauce", 0.08], ["veoil", 0.15]] },
  { key: "dal", name: "Mas-moong dal", ne: "दाल", cat: "PROTEIN", diet: "VEG", price: 35, station: "Dal & rice", desc: "Black lentil and moong, tempered with jimbu and ghee.", yield: 10, bom: [["masdal", 0.35], ["moong", 0.25], ["ghee", 0.04], ["spices", 0.02], ["garlic", 0.03]] },
  { key: "chxcurry", name: "Chicken curry", ne: "कुखुराको मासु", cat: "PROTEIN", diet: "CHICKEN", verified: true, price: 120, spice: 2, station: "Curry", portion: "≈90 g chicken", yield: 10, bom: [["chicken", 1.0, 5], ["onion", 0.4, 10], ["tomato", 0.3], ["ginger", 0.05], ["garlic", 0.05], ["spices", 0.05], ["veoil", 0.12]] },
  { key: "eggcurry", name: "Egg curry", ne: "अण्डा करी", cat: "PROTEIN", diet: "EGG", verified: true, price: 70, spice: 2, station: "Curry", yield: 10, bom: [["eggs", 20], ["onion", 0.4, 10], ["tomato", 0.4], ["spices", 0.04], ["veoil", 0.1]] },
  { key: "paneer", name: "Paneer tarkari", ne: "पनिर तरकारी", cat: "PROTEIN", diet: "VEG", price: 110, station: "Curry", yield: 10, bom: [["paneer", 0.8], ["onion", 0.3, 10], ["tomato", 0.4], ["spices", 0.04], ["veoil", 0.1]] },
  { key: "rajma", name: "Rajma", ne: "राज्मा", cat: "PROTEIN", diet: "VEGAN", price: 60, station: "Curry", yield: 10, bom: [["rajma", 0.7], ["onion", 0.3, 10], ["tomato", 0.4], ["spices", 0.04], ["veoil", 0.08]] },
  { key: "mushchoila", name: "Mushroom choila", ne: "च्याउ छोइला", cat: "PROTEIN", diet: "VEGAN", price: 90, spice: 3, station: "Choila & grill", desc: "Grilled mushroom with mustard oil, chilli and timur.", yield: 10, bom: [["mushroom", 1.2, 8], ["mustardoil", 0.08], ["timur", 0.01], ["garlic", 0.04], ["spices", 0.02]] },
  { key: "soychoila", name: "Soybean choila", ne: "भटमास छोइला", cat: "PROTEIN", diet: "VEGAN", price: 60, spice: 3, station: "Choila & grill", yield: 10, bom: [["soybean", 0.6], ["mustardoil", 0.06], ["timur", 0.01], ["onion", 0.15]] },
  { key: "mushroll", name: "Mushroom choila egg roll", cat: "MAIN", diet: "EGG", verified: true, price: 110, spice: 2, station: "Choila & grill", custom: false, desc: "Smoky mushroom choila wrapped in a thin egg-washed paratha.", yield: 10, bom: [["maida", 0.8], ["eggs", 10], ["mushroom", 0.8, 8], ["mustardoil", 0.06], ["timur", 0.008], ["veoil", 0.1]] },
  { key: "soyroll", name: "Soybean choila roll", cat: "MAIN", diet: "VEGAN", price: 90, spice: 2, station: "Choila & grill", custom: false, desc: "Soybean choila, onion and coriander in a wheat roll (no egg).", yield: 10, bom: [["maida", 0.8], ["soybean", 0.5], ["onion", 0.2], ["mustardoil", 0.05], ["veoil", 0.08]] },
  { key: "pasta", name: "Creamy mushroom pasta", cat: "MAIN", diet: "VEG", price: 240, station: "Wok", prep: 15, custom: false, yield: 10, bom: [["penne", 1.1], ["mushroom", 0.9, 8], ["cream", 0.6], ["garlic", 0.06], ["veoil", 0.06]] },
  { key: "tikki", name: "Aloo tikki ×2", ne: "आलु टिक्की", cat: "SIDE", diet: "VEGAN", price: 50, station: "Fry", yield: 10, bom: [["potato", 1.4, 12], ["spices", 0.02], ["veoil", 0.25]] },
  { key: "tarkari", name: "Seasonal tarkari", ne: "मौसमी तरकारी", cat: "VEGETABLE", diet: "VEGAN", price: 40, station: "Curry", desc: "Whatever was best at Kalimati that morning.", yield: 10, bom: [["cauli", 0.8, 15], ["potato", 0.5, 12], ["spices", 0.02], ["veoil", 0.08]] },
  { key: "saag", name: "Rayo saag", ne: "रायोको साग", cat: "VEGETABLE", diet: "VEGAN", price: 35, station: "Curry", yield: 10, bom: [["rayo", 1.2, 20], ["garlic", 0.03], ["mustardoil", 0.05]] },
  { key: "aloocauli", name: "Aloo cauli", ne: "आलु काउली", cat: "VEGETABLE", diet: "VEGAN", price: 45, station: "Curry", yield: 10, bom: [["cauli", 0.7, 15], ["potato", 0.6, 12], ["spices", 0.03], ["veoil", 0.08]] },
  { key: "salad", name: "Cucumber-radish salad", ne: "सलाद", cat: "SIDE", diet: "VEGAN", verified: true, price: 25, station: "Cold & khaja", noOG: true, yield: 10, bom: [["cucumber", 0.6, 10], ["radish", 0.4, 10]] },
  { key: "gundruk", name: "Gundruk achar", ne: "गुन्द्रुक", cat: "ACHAR", diet: "VEGAN", price: 20, spice: 2, station: "Achar", desc: "Fermented leafy greens, made in our kitchen.", yield: 20, bom: [["gundruk", 0.3], ["mustardoil", 0.05], ["tomato", 0.2], ["onion", 0.1]] },
  { key: "golbheda", name: "Golbheda achar", ne: "गोलभेडा अचार", cat: "ACHAR", diet: "VEGAN", price: 15, spice: 2, station: "Achar", yield: 20, bom: [["tomato", 1.0], ["sesame", 0.04], ["timur", 0.005]] },
  { key: "mula", name: "Mula achar", ne: "मुला अचार", cat: "ACHAR", diet: "VEGAN", price: 15, spice: 2, station: "Achar", yield: 20, bom: [["radish", 1.0, 10], ["mustardoil", 0.05], ["sesame", 0.03]] },
  { key: "timurchutney", name: "Timur chutney", ne: "टिमुर चटनी", cat: "ACHAR", diet: "VEGAN", price: 15, spice: 3, station: "Achar", yield: 20, bom: [["tomato", 0.5], ["timur", 0.02], ["garlic", 0.03]] },
  { key: "dahi", name: "Dahi (curd)", ne: "दही", cat: "ADDON", diet: "VEG", verified: true, price: 30, station: "Cold & khaja", noOG: true, yield: 10, bom: [["dahi", 1.0]] },
  { key: "fruit", name: "Seasonal fruit cup", ne: "फलफूल", cat: "ADDON", diet: "VEGAN", verified: true, price: 40, station: "Cold & khaja", noOG: true, yield: 10, bom: [["fruit", 1.2, 20]] },
  { key: "boiledegg", name: "Boiled egg", ne: "उसिनेको अण्डा", cat: "ADDON", diet: "EGG", verified: true, price: 25, station: "Cold & khaja", noOG: true, yield: 10, bom: [["eggs", 10]] },
  { key: "sadeko", name: "Bhatmas sadeko", ne: "भटमास सादेको", cat: "SIDE", diet: "VEGAN", price: 40, spice: 2, station: "Cold & khaja", yield: 10, bom: [["soybean", 0.5], ["onion", 0.15], ["mustardoil", 0.04]] },
];

type Box = { slug: string; name: string; ne?: string; tagline: string; taglineNe?: string; desc: string; health: string; kitchen: string; price: number; accent: string; items: string[]; tags: string[]; special?: boolean; subs?: [string, string, number][] };

/** The six boxes from the reference menu card (Sunday–Friday), plus three that widen the rotation. */
const BOXES: Box[] = [
  {
    slug: "signature-dal-bhat",
    name: "Signature Dal Bhat Box",
    ne: "सिग्नेचर दाल भात",
    tagline: "Dal bhat tarkari with our own gundruk",
    taglineNe: "दाल, भात, तरकारी र घरमै बनाएको गुन्द्रुक",
    desc: "The dabba we'd eat every day: mas-moong dal, fresh rice, seasonal tarkari, rayo saag and a spoon of gundruk achar fermented in our kitchen.",
    health: "A full plate in the Nepali way — grain, lentils and two vegetables — with no fried items.",
    kitchen: "Anchor recipe. Dal, rice and gundruk are batch-cooked; the most predictable box to cost.",
    price: 200,
    accent: "turmeric",
    items: ["rice", "dal", "tarkari", "saag", "gundruk"],
    tags: ["Classic"],
    subs: [["rice", "roti", 0]],
  },
  {
    slug: "wok-and-spud",
    name: "Wok & Spud",
    ne: "वक एन्ड स्पड",
    tagline: "Chicken fried rice + aloo tikki",
    taglineNe: "कुखुराको फ्राइड राइस र आलु टिक्की",
    desc: "Wok-hot chicken fried rice with two crisp aloo tikki and golbheda achar.",
    health: "A weighed chicken portion (about 90 g) so every dabba gets the same protein.",
    kitchen: "Shares the wok station and rice batch with Wednesday's noodles. Weigh the chicken.",
    price: 200,
    accent: "achar",
    items: ["chxfried", "tikki", "golbheda"],
    tags: ["Chicken"],
    subs: [["chxfried", "vegfried", -20], ["tikki", "salad", -10]],
  },
  {
    slug: "choila-roll-duo",
    name: "Choila Roll Duo",
    ne: "छोइला रोल जोडी",
    tagline: "Mushroom choila egg roll + soybean choila roll",
    taglineNe: "च्याउ छोइला अण्डा रोल र भटमास छोइला रोल",
    desc: "Two rolls, two choilas: smoky mushroom wrapped with egg, and a soybean roll, with timur chutney on the side.",
    health: "Most of the protein comes from mushroom and soybean. The mushroom roll contains egg.",
    kitchen: "One choila spice base (mustard oil, chilli, timur) for both rolls.",
    price: 200,
    accent: "saag",
    items: ["mushroll", "soyroll", "timurchutney"],
    tags: ["Plant-forward"],
    subs: [["mushroll", "soyroll", 0]],
  },
  {
    slug: "garlic-noodle-box",
    name: "Garlic Noodle Box",
    ne: "लसुन चाउचाउ बक्स",
    tagline: "Garlic veggie noodles + aloo tikki",
    taglineNe: "लसुन चाउचाउ र आलु टिक्की",
    desc: "Garlic-forward vegetable noodles with cabbage and carrot, plus aloo tikki and mula achar.",
    health: "Plenty of vegetables tossed through the noodles; egg-free noodles.",
    kitchen: "Same wok and veg-chop prep as Monday's fried rice.",
    price: 200,
    accent: "turmeric",
    items: ["garlicnoodle", "tikki", "mula"],
    tags: ["Veg"],
    subs: [["tikki", "boiledegg", 0]],
  },
  {
    slug: "fusion-special",
    name: "Fusion Special",
    ne: "फ्युजन स्पेसल",
    tagline: "Creamy mushroom pasta",
    taglineNe: "क्रिमी च्याउ पास्ता",
    desc: "Our once-a-week treat: penne in a light mushroom cream with garlic and a pinch of timur.",
    health: "A richer day — cream makes this the heaviest box of the week.",
    kitchen: "Thursday only. Cream pushes the cost past Rs 200; price provisional until costed.",
    price: 240,
    accent: "charcoal",
    items: ["pasta", "salad"],
    tags: ["Special"],
    special: true,
  },
  {
    slug: "weekend-send-off",
    name: "Weekend Send-off",
    ne: "हप्ताको बिदाइ",
    tagline: "Soybean choila roll + chicken fried rice",
    taglineNe: "भटमास छोइला रोल र कुखुराको फ्राइड राइस",
    desc: "A Friday combo: half a portion of chicken fried rice with a soybean choila roll.",
    health: "Half rice, half roll — a lighter take on two weekday favourites.",
    kitchen: "Reuses Tuesday's choila base and Monday's rice batch. Check cost before fixing at Rs 200.",
    price: 200,
    accent: "achar",
    items: ["soyroll", "chxfried"],
    tags: ["Chicken", "Combo"],
  },
  {
    slug: "rajma-bhat",
    name: "Rajma Bhat Box",
    ne: "राज्मा भात",
    tagline: "Rajma, jeera rice, salad, dahi",
    taglineNe: "राज्मा, जिरा भात, सलाद र दही",
    desc: "Slow-cooked rajma over jeera rice, with cucumber-radish salad and a cup of dahi.",
    health: "Beans and curd make this a filling vegetarian plate.",
    kitchen: "Rajma soaked overnight, pressure-cooked in one batch.",
    price: 180,
    accent: "turmeric",
    items: ["jeera", "rajma", "salad", "dahi"],
    tags: ["Veg", "Budget"],
  },
  {
    slug: "kukhura-bhat",
    name: "Kukhura Bhat Box",
    ne: "कुखुरा भात",
    tagline: "Chicken curry, rice, dal, saag, achar",
    taglineNe: "कुखुराको मासु, भात, दाल, साग र अचार",
    desc: "Home-style chicken curry with rice, a small dal, rayo saag and golbheda achar.",
    health: "A weighed 90 g chicken portion alongside dal and greens.",
    kitchen: "Curry base shared with egg-curry days.",
    price: 230,
    accent: "achar",
    items: ["rice", "chxcurry", "dal", "saag", "golbheda"],
    tags: ["Chicken"],
    subs: [["chxcurry", "eggcurry", -40]],
  },
  {
    slug: "newari-khaja-set",
    name: "Newari Khaja Set",
    ne: "नेवारी खाजा सेट",
    tagline: "Chiura, choila, sadeko, achar",
    taglineNe: "चिउरा, छोइला, सादेको र अचार",
    desc: "Our office-friendly take on a samay baji plate: chiura, mushroom choila, bhatmas sadeko, aloo tikki and mula achar.",
    health: "Light base, lots of texture; mushroom choila keeps it vegetarian.",
    kitchen: "Cold-assembly box — eases pressure on the wok station on busy days.",
    price: 210,
    accent: "saag",
    items: ["chiura", "mushchoila", "sadeko", "tikki", "mula"],
    tags: ["Veg", "Newari"],
  },
];

/** Default weekly rotation (Sun–Fri), straight from the reference menu card, with a veg alternative each day. */
const ROTATION: Partial<Record<Weekday, string[]>> = {
  SUN: ["signature-dal-bhat", "kukhura-bhat"],
  MON: ["wok-and-spud", "signature-dal-bhat"],
  TUE: ["choila-roll-duo", "rajma-bhat"],
  WED: ["garlic-noodle-box", "kukhura-bhat"],
  THU: ["fusion-special", "signature-dal-bhat"],
  FRI: ["weekend-send-off", "newari-khaja-set"],
};

const ZONES = [
  { name: "Baneshwor & Shantinagar", areas: ["New Baneshwor", "Old Baneshwor", "Shantinagar", "Min Bhawan", "Buddhanagar", "Thapagaun", "Mid-Baneshwor"], wards: ["KMC-10", "KMC-31"], fee: 30, eta: "12:00 – 1:15 PM" },
  { name: "Putalisadak & Dillibazar", areas: ["Putalisadak", "Dillibazar", "Bagbazar", "Kamaladi", "Hattisar", "Gyaneshwor", "Maitighar", "Babarmahal", "Anamnagar"], wards: ["KMC-1", "KMC-11", "KMC-29", "KMC-30"], fee: 40, eta: "12:00 – 1:15 PM" },
  { name: "Durbarmarg & Thamel", areas: ["Durbarmarg", "Lazimpat", "Thamel", "Naxal", "Jamal", "Kantipath", "Lainchaur"], wards: ["KMC-1", "KMC-2", "KMC-26", "KMC-29"], fee: 50, eta: "12:15 – 1:30 PM" },
  { name: "Pulchowk & Jhamsikhel", areas: ["Pulchowk", "Jhamsikhel", "Sanepa", "Kupondole", "Jawalakhel", "Bakhundole", "Ekantakuna"], wards: ["LMC-2", "LMC-3", "LMC-4", "LMC-5", "LMC-14"], fee: 50, eta: "12:15 – 1:30 PM" },
  { name: "Koteshwor & Tinkune", areas: ["Koteshwor", "Tinkune", "Sinamangal", "Balkumari", "Jadibuti", "Airport"], wards: ["KMC-32", "KMC-35"], fee: 40, eta: "12:00 – 1:15 PM" },
  { name: "Teku & Tripureshwor", areas: ["Teku", "Tripureshwor", "Kalimati", "Kuleshwor", "Thapathali", "Sundhara", "New Road"], wards: ["KMC-12", "KMC-13", "KMC-14", "KMC-22"], fee: 50, eta: "12:30 – 1:30 PM" },
];

const PLANS = [
  {
    slug: "hapta",
    name: "Hapta — one week",
    nameNe: "हप्ता",
    kind: "WEEKLY" as const,
    tagline: "Try a week of lunches without committing to a month.",
    weeks: 1,
    minDays: 3,
    perMeal: 185,
    compareAt: 200,
    features: ["Pick 3 to 6 days", "Chef's rotation or pick each day", "Skip a day before 9:30 AM", "Delivery included"],
    popular: false,
    corporate: false,
  },
  {
    slug: "pura-mahina",
    name: "Pura Mahina — four weeks",
    nameNe: "पूरा महिना",
    kind: "MONTHLY" as const,
    tagline: "Four weeks of service days. Counted in real delivery days, holidays excluded.",
    weeks: 4,
    minDays: 4,
    perMeal: 175,
    compareAt: 200,
    features: ["Lowest per-dabba price", "Holidays skipped automatically", "Pause when you travel", "Delivery included"],
    popular: true,
    corporate: false,
  },
  {
    slug: "do-hapta",
    name: "Do Hapta — two weeks",
    nameNe: "दुई हप्ता",
    kind: "CUSTOM" as const,
    tagline: "Two weeks, any days you like.",
    weeks: 2,
    minDays: 2,
    perMeal: 180,
    compareAt: 200,
    features: ["As few as 2 days a week", "Build your own calendar", "Delivery included"],
    popular: false,
    corporate: false,
  },
  {
    slug: "team-plan",
    name: "Team plan — four weeks",
    nameNe: "टोली योजना",
    kind: "OFFICE" as const,
    tagline: "For companies feeding 10 or more people. One monthly invoice.",
    weeks: 4,
    minDays: 5,
    perMeal: 165,
    compareAt: 200,
    features: ["Company-paid, employee-paid or split", "Monthly VAT invoice", "One hand-off at reception", "Mixed veg / non-veg"],
    popular: false,
    corporate: true,
  },
];

const FAQS = [
  ["Ordering", "Until when can I order for today?", "Same-day orders close at 9:30 AM. You can book up to four weeks ahead."],
  ["Ordering", "Do you only deliver to offices?", "No. We deliver lunch to offices, shops, colleges, work sites and homes — anywhere inside our delivery areas. Check your locality on the Delivery areas page."],
  ["Plans", "How is a monthly plan counted?", "In real delivery days. A four-week plan on Sunday–Friday has up to 24 lunches; public holidays and kitchen closures are left out and you are not charged for them."],
  ["Plans", "What happens when I skip a day?", "Skip before 9:30 AM on the day. The meal moves to the end of your plan, so you don't lose it."],
  ["Plans", "Can I pause my plan?", "Yes. Pause from your account; the remaining meals wait until you resume."],
  ["Food", "Is the food spicy?", "Most dabbas are medium. Every dish shows a spice level, and achar comes on the side."],
  ["Food", "I have an allergy. Is it safe?", "Each dish lists its allergens. Our kitchen handles wheat, dairy, egg, soy, sesame and mustard, so we can't promise zero cross-contact. Tell us your allergies in your profile and we'll flag them on your label."],
  ["Food", "Are the calorie numbers exact?", "Where we show nutrition, it's an estimate from our recipe weights and labelled that way. We don't publish numbers we haven't worked out."],
  ["Payment", "How can I pay?", "eSewa, Khalti, bank transfer / Fonepay QR, or cash on delivery. Companies can be billed monthly."],
  ["Payment", "What if I cancel?", "Cancel before 9:30 AM on the day and the full amount goes back to your Dabba Bela credit, which you can spend on your next order."],
  ["Teams", "Can our company pay for staff lunches?", "Yes — company-paid, employee-paid or a split (for example the company pays 50%). Admins get one monthly invoice with PAN/VAT details."],
];

const PAGES = [
  {
    slug: "terms",
    title: "Terms of service",
    body: `# Terms of service\n\n> **Draft — needs legal review before launch.**\n\nThese terms cover ordering lunch from Dabba Bela through this website.\n\n## Orders\n- Same-day orders close at the cut-off time shown at checkout (9:30 AM by default).\n- We may cancel an order if we can't deliver to your address; you'll get your money back in full.\n\n## Prices\nPrices are in Nepali rupees and include VAT where we are VAT-registered. Delivery fees are shown before you pay.\n\n## Your account\nKeep your password safe. Tell us at once if you think someone else has used your account.\n\n## Contact\nWrite to us from the Contact page.`,
  },
  {
    slug: "privacy",
    title: "Privacy policy",
    body: `# Privacy policy\n\n> **Draft — needs legal review before launch.**\n\n## What we collect\nYour name, phone number, email, delivery addresses, food preferences and allergies, and your order history.\n\n## Why\nTo cook and deliver your lunch, to contact you about an order, and — only if you opt in — to tell you about new menus.\n\n## Who sees it\nOur kitchen and delivery team see what they need to prepare and deliver your order. Payment providers (eSewa, Khalti, your bank) process payments under their own policies. We don't sell your data.\n\n## How long we keep it\nOrder and payment records are kept as long as tax law requires. You can ask us to export or delete the rest of your data from your account.\n\n## Analytics\nWe measure page visits without advertising trackers.`,
  },
  {
    slug: "refunds",
    title: "Cancellation & refund policy",
    body: `# Cancellation & refund policy\n\n> **Draft — needs legal review before launch.**\n\n- **Before the cut-off (9:30 AM on the day):** cancel any order from your account. The full amount goes back to your Dabba Bela credit. If you'd rather have the money back to eSewa/Khalti/bank, ask us and we'll process it within 7 working days.\n- **After the cut-off:** the kitchen has started cooking, so we can't cancel. If something goes wrong with your lunch, contact us the same day.\n- **Plans:** skipping before the cut-off moves the meal to the end of your plan. Cancelling a plan returns the value of the meals that haven't been locked yet as credit.\n- **When we can't deliver** (bandh, weather, our mistake) you choose between a later delivery or full credit.`,
  },
  {
    slug: "allergens",
    title: "Allergen information",
    body: `# Allergen information\n\nEvery dish lists the allergens in its recipe. Our kitchen also handles **wheat (gluten), milk, egg, soy, sesame and mustard**, and dishes share cooking equipment.\n\nWe take care, but **we cannot guarantee that any dish is free from traces of these allergens.** If you have a severe allergy, please talk to us before ordering.\n\nAdd your allergies to your profile — they're printed on your dabba label so the packing team double-checks your order.`,
  },
  {
    slug: "food-safety",
    title: "Food safety",
    body: `# Food safety\n\n> **To be completed with the kitchen's actual registration and inspection details before launch.**\n\nThis page will describe our kitchen registration, how we store and cook food, temperature checks before dispatch, and how staff hygiene is checked. We don't claim certifications we don't hold.`,
  },
  {
    slug: "accessibility",
    title: "Accessibility",
    body: `# Accessibility\n\nWe want everyone to be able to order lunch here. The site is built to WCAG 2.1 AA: it works with a keyboard, with screen readers, with larger text, and respects reduced-motion settings.\n\nIf something gets in your way, tell us from the Contact page and we'll fix it.`,
  },
];

const POSTS = [
  {
    slug: "why-the-menu-changes-every-week",
    title: "Why our menu changes every week",
    excerpt: "Rotating six dabbas lets us cook fresh, buy smart at Kalimati, and keep lunch interesting.",
    body: `Eating the same lunch every day gets old fast — and cooking the same thing every day is wasteful for a kitchen.\n\nSo we plan the week as a rotation. Monday's fried rice shares a wok station and rice batch with Wednesday's noodles. Tuesday's choila spice base comes back on Friday. That means less waste, faster mornings, and prices that stay around Rs 200.\n\nEvery day also has a vegetarian option, and if a day doesn't suit you, you can build your own dabba instead.`,
    tags: ["Kitchen"],
  },
];

// ───────────── seeding ─────────────

export type SeedOptions = { owner?: { name: string; email: string; password: string }; demo?: boolean; log?: (s: string) => void };

async function upsertAccount(db: PrismaClient, userId: string, password: string) {
  const hash = await hashPassword(password);
  const existing = await db.account.findFirst({ where: { userId, providerId: "credential" } });
  if (existing) await db.account.update({ where: { id: existing.id }, data: { password: hash } });
  else await db.account.create({ data: { userId, accountId: userId, providerId: "credential", password: hash } });
}

export async function createUserWithPassword(db: PrismaClient, u: { name: string; email: string; password: string; role?: Role; phoneNumber?: string | null }) {
  const user = await db.user.upsert({
    where: { email: u.email.toLowerCase() },
    create: { name: u.name, email: u.email.toLowerCase(), emailVerified: true, role: u.role ?? "CUSTOMER", phoneNumber: u.phoneNumber ?? null },
    update: { role: u.role ?? undefined },
  });
  await upsertAccount(db, user.id, u.password);
  return user;
}

export async function seedCatalog(db: PrismaClient, opts: SeedOptions = {}) {
  const say = opts.log ?? (() => {});

  for (const [i, [code, name, ne]] of ALLERGENS.entries())
    await db.allergen.upsert({ where: { code }, create: { code, name, nameNe: ne, sortOrder: i }, update: { name, nameNe: ne } });
  const allergenId = new Map((await db.allergen.findMany()).map((a) => [a.code, a.id]));

  const kitchen = await db.kitchen.upsert({
    where: { code: "KTM-1" },
    create: { name: "Baneshwor kitchen", code: "KTM-1", city: "Kathmandu", address: "New Baneshwor, Kathmandu (pilot)", dailyCapacity: 300 },
    update: {},
  });
  if (!(await db.deliverySlot.count({ where: { kitchenId: kitchen.id } }))) {
    await db.deliverySlot.createMany({
      data: [
        { kitchenId: kitchen.id, label: "12:00 – 12:30", startTime: "12:00", endTime: "12:30", capacity: 80, sortOrder: 1 },
        { kitchenId: kitchen.id, label: "12:30 – 1:00", startTime: "12:30", endTime: "13:00", capacity: 100, sortOrder: 2 },
        { kitchenId: kitchen.id, label: "1:00 – 1:30", startTime: "13:00", endTime: "13:30", capacity: 80, sortOrder: 3 },
      ],
    });
  }
  for (const [i, z] of ZONES.entries()) {
    const found = await db.deliveryZone.findFirst({ where: { name: z.name } });
    const data = { name: z.name, areas: z.areas, wards: z.wards, fee: R(z.fee), freeAbove: R(1000), etaNote: z.eta, sortOrder: i, kitchenId: kitchen.id };
    if (found) await db.deliveryZone.update({ where: { id: found.id }, data });
    else await db.deliveryZone.create({ data });
  }
  say("kitchen, slots, zones");

  const suppliers: Record<string, string> = {};
  for (const [key, name, note] of [
    ["kalimati", "Kalimati vegetable supplier (to be named)", "Daily vegetables — placeholder supplier, replace with your real vendor."],
    ["meat", "Meat & dairy supplier (to be named)", "Chicken, eggs, paneer, dahi — placeholder."],
    ["dry", "Dry goods wholesaler (to be named)", "Rice, lentils, oil, spices, packaging — placeholder."],
  ] as const) {
    const s = (await db.supplier.findFirst({ where: { name } })) ?? (await db.supplier.create({ data: { name, notes: note } }));
    suppliers[key] = s.id;
  }
  const ingId = new Map<string, string>();
  for (const g of INGREDIENTS) {
    const row = await db.ingredient.upsert({
      where: { name: g.name },
      create: { name: g.name, nameNe: g.ne, unit: g.unit, costPerUnit: g.cost, safetyStock: g.safety, reorderQty: g.reorder, allergenCodes: g.allergens ?? [], supplierId: g.supplier ? suppliers[g.supplier] : null },
      update: { costPerUnit: g.cost },
    });
    ingId.set(g.key, row.id);
  }
  say("ingredients & suppliers");

  const dishId = new Map<string, string>();
  for (const [i, d] of DISHES.entries()) {
    const existing = await db.menuItem.findFirst({ where: { name: d.name } });
    const data = {
      name: d.name,
      nameNe: d.ne,
      description: d.desc,
      category: d.cat,
      diet: d.diet,
      dietVerified: Boolean(d.verified),
      hasOnionGarlic: !d.noOG,
      spiceLevel: d.spice ?? 1,
      station: d.station,
      prepMinutes: d.prep,
      portionLabel: d.portion,
      price: R(d.price),
      allowCustom: d.custom !== false,
      dailyLimit: d.limit,
      sortOrder: i,
    };
    const item = existing ? await db.menuItem.update({ where: { id: existing.id }, data }) : await db.menuItem.create({ data });
    dishId.set(d.key, item.id);
    // allergens = union of ingredient allergens (+ may-contain)
    const codes = new Set(d.bom.flatMap(([k]) => INGREDIENTS.find((g) => g.key === k)?.allergens ?? []));
    await db.menuItemAllergen.deleteMany({ where: { menuItemId: item.id } });
    const rows = [
      ...[...codes].map((c) => ({ menuItemId: item.id, allergenId: allergenId.get(c)!, mayContain: false })),
      ...(d.mayContain ?? []).filter((c) => !codes.has(c)).map((c) => ({ menuItemId: item.id, allergenId: allergenId.get(c)!, mayContain: true })),
    ];
    if (rows.length) await db.menuItemAllergen.createMany({ data: rows });
    // recipe v1 with BOM + cost per portion
    if (!(await db.recipe.findUnique({ where: { menuItemId: item.id } }))) {
      const recipe = await db.recipe.create({ data: { menuItemId: item.id } });
      let cost = 0;
      for (const [k, qty, waste = 0] of d.bom) cost += (INGREDIENTS.find((g) => g.key === k)!.cost * qty) / (1 - waste / 100);
      const v = await db.recipeVersion.create({
        data: {
          recipeId: recipe.id,
          version: 1,
          yieldPortions: d.yield,
          costPerPortion: Math.round(cost / d.yield),
          notes: "Starter recipe — quantities are planning estimates; weigh and update after the first test cook.",
          ingredients: { create: d.bom.map(([k, qty, waste = 0]) => ({ ingredientId: ingId.get(k)!, quantity: qty, wastePct: waste })) },
        },
      });
      await db.recipe.update({ where: { id: recipe.id }, data: { currentVersionId: v.id } });
      await db.menuItem.update({ where: { id: item.id }, data: { costPrice: Math.round(cost / d.yield) } });
    }
  }
  say("dishes, allergens, recipes");

  const boxId = new Map<string, string>();
  for (const [i, b] of BOXES.entries()) {
    const data = {
      name: b.name,
      nameNe: b.ne,
      tagline: b.tagline,
      taglineNe: b.taglineNe,
      description: b.desc,
      healthNote: b.health,
      kitchenNote: b.kitchen,
      price: R(b.price),
      accent: b.accent,
      isSpecial: Boolean(b.special),
      tags: b.tags,
      sortOrder: i,
    };
    const box = await db.lunchBox.upsert({ where: { slug: b.slug }, create: { slug: b.slug, ...data }, update: data });
    boxId.set(b.slug, box.id);
    await db.boxItem.deleteMany({ where: { boxId: box.id } });
    await db.boxItem.createMany({ data: b.items.map((k, j) => ({ boxId: box.id, menuItemId: dishId.get(k)!, quantity: 1, sortOrder: j })) });
    let cost = 0;
    for (const k of b.items) cost += (await db.menuItem.findUniqueOrThrow({ where: { id: dishId.get(k)! } })).costPrice;
    cost += INGREDIENTS.find((g) => g.key === "box")!.cost;
    await db.lunchBox.update({ where: { id: box.id }, data: { costPrice: cost } });
    for (const [from, to, delta] of b.subs ?? [])
      await db.boxSubstitution.upsert({
        where: { boxId_fromItemId_toItemId: { boxId: box.id, fromItemId: dishId.get(from)!, toItemId: dishId.get(to)! } },
        create: { boxId: box.id, fromItemId: dishId.get(from)!, toItemId: dishId.get(to)!, priceDelta: R(delta) },
        update: { priceDelta: R(delta) },
      });
  }
  say("dabbas");

  const GROUPS: [string, string, string, ItemCategory, number, number][] = [
    ["base", "Pick a base", "आधार छान्नुहोस्", "BASE", 1, 1],
    ["main", "Main dish", "मुख्य परिकार", "MAIN", 0, 1],
    ["protein", "Protein", "प्रोटिन", "PROTEIN", 0, 2],
    ["veg", "Vegetables", "तरकारी", "VEGETABLE", 0, 2],
    ["side", "Sides", "साइड", "SIDE", 0, 2],
    ["achar", "Achar", "अचार", "ACHAR", 0, 1],
    ["addon", "Add-ons", "थप", "ADDON", 0, 3],
  ];
  for (const [i, [key, name, ne, cat, min, max]] of GROUPS.entries()) {
    const g = await db.customizationGroup.upsert({ where: { key }, create: { key, name, nameNe: ne, category: cat, minSelect: min, maxSelect: max, sortOrder: i }, update: {} });
    for (const d of DISHES.filter((x) => x.cat === cat && x.custom !== false))
      await db.customizationOption.upsert({ where: { groupId_menuItemId: { groupId: g.id, menuItemId: dishId.get(d.key)! } }, create: { groupId: g.id, menuItemId: dishId.get(d.key)! }, update: {} });
  }
  // Fried rice / noodles already carry their own base.
  const mainsWithBase = ["chxfried", "vegfried", "garlicnoodle"];
  const baseGroup = await db.customizationGroup.findUniqueOrThrow({ where: { key: "base" } });
  await db.customizationGroup.update({ where: { id: baseGroup.id }, data: { minSelect: 0 } });
  for (const m of mainsWithBase)
    for (const b of ["rice", "jeera", "chiura", "roti"])
      await db.comboRule.upsert({
        where: { kind_itemAId_itemBId: { kind: "EXCLUDE", itemAId: dishId.get(m)!, itemBId: dishId.get(b)! } },
        create: { kind: "EXCLUDE", itemAId: dishId.get(m)!, itemBId: dishId.get(b)!, message: "Fried rice and noodles already fill the base — drop the rice/roti" },
        update: {},
      });
  say("build-a-dabba rules");

  if (!(await db.weeklyMenu.findFirst({ where: { isDefault: true } }))) {
    await db.weeklyMenu.create({
      data: {
        title: "Standing rotation",
        isDefault: true,
        status: "PUBLISHED",
        publishedAt: new Date(),
        note: "From the reference menu card. Used whenever a week has no menu of its own.",
        days: {
          create: (["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as Weekday[]).map((day) => ({
            day,
            isClosed: !ROTATION[day],
            items: { create: (ROTATION[day] ?? []).map((slug, j) => ({ boxId: boxId.get(slug)!, isPrimary: j === 0, sortOrder: j })) },
          })),
        },
      },
    });
  }
  say("weekly rotation");

  for (const [i, p] of PLANS.entries()) {
    const data = {
      name: p.name,
      nameNe: p.nameNe,
      kind: p.kind,
      tagline: p.tagline,
      durationWeeks: p.weeks,
      minDaysPerWeek: p.minDays,
      pricePerMeal: R(p.perMeal),
      compareAtPrice: R(p.compareAt),
      features: p.features,
      isPopular: p.popular,
      isCorporate: p.corporate,
      policyNote: "Skip or pause before 9:30 AM on the day. Cancelling returns unlocked meals as credit. Renewal is manual.",
      sortOrder: i,
    };
    await db.mealPlan.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data }, update: data });
  }
  if (!(await db.taxRule.count()))
    await db.taxRule.create({ data: { name: "VAT 13% (inclusive)", rateBps: 1300, inclusive: true, isActive: false, effectiveFrom: dateOnly("2026-01-01") } });
  for (const c of [
    { code: "PAHILO", description: "15% off your first order (max Rs 60)", type: "PERCENT" as const, value: 15, maxDiscount: R(60), firstOrderOnly: true, scope: "ORDERS" as const },
    { code: "HAPTA50", description: "Rs 50 off a weekly or monthly plan", type: "FLAT" as const, value: R(50), scope: "SUBSCRIPTIONS" as const, minSubtotal: R(500) },
  ])
    await db.coupon.upsert({ where: { code: c.code }, create: c, update: {} });
  for (const [i, [cat, q, a]] of FAQS.entries()) if (!(await db.faq.findFirst({ where: { question: q } }))) await db.faq.create({ data: { category: cat, question: q, answer: a, sortOrder: i } });
  for (const p of PAGES) await db.page.upsert({ where: { slug: p.slug }, create: { ...p, needsLegalReview: p.slug !== "accessibility" }, update: {} });
  for (const p of POSTS) await db.post.upsert({ where: { slug: p.slug }, create: { ...p, author: "Dabba Bela kitchen", published: true, publishedAt: new Date() }, update: {} });
  say("plans, tax, coupons, FAQ, pages, journal");

  if (opts.owner) {
    await createUserWithPassword(db, { ...opts.owner, role: "SUPER_ADMIN" });
    say(`owner ${opts.owner.email}`);
  }
  if (opts.demo) await seedDemo(db, kitchen.id, boxId, say);
}

// ───────────── demo data (never in production) ─────────────

async function seedDemo(db: PrismaClient, kitchenId: string, boxId: Map<string, string>, say: (s: string) => void) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Refusing to seed demo data in production");
  const staff: [string, string, Role][] = [
    ["Ops Manager (demo)", "ops@demo.dabbabela.local", "OPERATIONS_MANAGER"],
    ["Head Chef (demo)", "chef@demo.dabbabela.local", "KITCHEN_STAFF"],
    ["Store Keeper (demo)", "stores@demo.dabbabela.local", "INVENTORY_MANAGER"],
    ["Dispatcher (demo)", "dispatch@demo.dabbabela.local", "DISPATCHER"],
    ["Rider One (demo)", "rider@demo.dabbabela.local", "DELIVERY_AGENT"],
    ["Finance (demo)", "finance@demo.dabbabela.local", "FINANCE"],
    ["Support (demo)", "support@demo.dabbabela.local", "SUPPORT"],
    ["Content Editor (demo)", "content@demo.dabbabela.local", "CONTENT_EDITOR"],
    ["Menu Manager (demo)", "menu@demo.dabbabela.local", "MENU_MANAGER"],
  ];
  for (const [name, email, role] of staff) await createUserWithPassword(db, { name, email, password: "demo-pass-123", role });

  const zones = await db.deliveryZone.findMany({ orderBy: { sortOrder: "asc" } });
  const company =
    (await db.company.findUnique({ where: { slug: "demo-company" } })) ??
    (await db.company.create({
      data: { name: "Demo Company (sample)", slug: "demo-company", joinCode: "DEMO26", billingMode: "SPLIT", subsidyPct: 50, subsidyCap: R(100), monthlyAllowance: R(2500), discountPct: 5, panVat: "000000000", billingAddress: "Sample address, Kathmandu", zoneId: zones[0].id, requireApproval: false },
    }));
  const location =
    (await db.officeLocation.findFirst({ where: { companyId: company.id } })) ??
    (await db.officeLocation.create({ data: { companyId: company.id, name: "Head office", line1: "Sample building, 3rd floor", area: "New Baneshwor", zoneId: zones[0].id, receiverName: "Reception" } }));

  const customers: { name: string; email: string; phone: string; area: string; type: "OFFICE" | "SHOP" | "COLLEGE" | "HOME"; place: string; company?: boolean; admin?: boolean }[] = [
    { name: "Sample Customer A", email: "customer.a@demo.dabbabela.local", phone: "+9779800000001", area: "New Baneshwor", type: "OFFICE", place: "Sample office", company: true, admin: true },
    { name: "Sample Customer B", email: "customer.b@demo.dabbabela.local", phone: "+9779800000002", area: "Putalisadak", type: "SHOP", place: "Sample electronics shop" },
    { name: "Sample Customer C", email: "customer.c@demo.dabbabela.local", phone: "+9779800000003", area: "Pulchowk", type: "COLLEGE", place: "Sample college" },
    { name: "Sample Customer D", email: "customer.d@demo.dabbabela.local", phone: "+9779800000004", area: "New Baneshwor", type: "OFFICE", place: "Sample office", company: true },
  ];
  for (const c of customers) {
    const u = await createUserWithPassword(db, { name: c.name, email: c.email, password: "demo-pass-123", phoneNumber: c.phone });
    const zone = zones.find((z) => z.areas.includes(c.area));
    if (!(await db.address.count({ where: { userId: u.id } })))
      await db.address.create({ data: { userId: u.id, label: c.type === "HOME" ? "Home" : c.place, type: c.type, recipientName: c.name, phone: c.phone, placeName: c.place, line1: "Sample street", area: c.area, zoneId: zone?.id, isDefault: true } });
    if (c.company)
      await db.companyMember.upsert({ where: { userId: u.id }, create: { companyId: company.id, userId: u.id, role: c.admin ? "ADMIN" : "MEMBER", status: "ACTIVE", department: "Sample team", officeLocationId: location.id }, update: {} });
  }
  void kitchenId;
  void boxId;
  void addDays;
  void weekStartOf;
  void todayKTM;
  say("demo staff, company and customers (password demo-pass-123)");
}
