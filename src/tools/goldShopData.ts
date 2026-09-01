// Shop classification mirroring lolshop.gg (john-riordan/hexcraft), the
// reference for the Gold Calculator's in-game-shop layout: a curated
// whitelist per champion class plus fixed basic/starter/consumable sets,
// with the same 1800g epic/legendary price breakpoint. Data Dragon alone
// can't produce these groups (no class or tier fields), so the curation
// is the source of truth and lives here as ids.

export const EPIC_LEGENDARY_BREAKPOINT = 1800;

// Ghostcrawler boots + Mobility Boots: not in the live SR shop.
export const BLACKLISTED_IDS = new Set(["3005", "3117"]);

// Zephyr and Slightly Magical Footwear carry a "Boots" tag without being
// shop boots.
export const BOOTS_BLACKLIST = new Set(["3172", "2422"]);

// Cheap items that are still legendary tier: the support quest finals and
// Mejai's.
export const LEGENDARY_OVERRIDES = new Set(["3871", "3877", "3876", "3870", "3869", "3041"]);

export const EPIC_OVERRIDES = new Set(["3867"]);

export const BASIC_IDS = new Set([
  "2022", "1004", "1042", "1029", "1006", "1027", "1036", "1052",
  "1028", "1033", "1018", "1026", "1037", "1058", "1038",
]);

export const STARTER_IDS = new Set([
  "1101", "1102", "1103", "1056", "1054", "1055", "3865", "3070", "1082", "1083",
]);

export const CONSUMABLE_IDS = new Set(["2031", "2003", "2138", "2139", "2140"]);

// The support-quest line: what the reserved support slot accepts.
export const SUPPORT_ITEM_IDS = new Set(["3865", "3867", "3869", "3870", "3871", "3876", "3877"]);
export const SUPPORT_STARTER_ID = "3865"; // World Atlas

export type ShopClassId = "fighter" | "marksman" | "assassin" | "mage" | "tank" | "support";

const FIGHTER = [
  "6692", "6609", "3026", "3156", "3091", "3153", "6333", "3053", "3074", "3071", "3748", "3742",
  "3302", "3073", "3181", "6631", "3161", "6610", "3078", "6694", "3004", "2501", "2517",
  "3057", "1031", "3067", "3123", "1011", "1053", "1057", "1043", "3044", "3051", "3133", "3077",
  "3140", "3155", "3035", "2020", "2019",
  "1029", "1042", "1036", "1028", "1033", "1037", "1038", "2022",
  "1054", "1055", "1083", "1101", "1102", "1103", "3070",
];

const MARKSMAN = [
  "3004", "3033", "3094", "3095", "3026", "3046", "3036", "3139", "3508", "6676", "3156", "3153",
  "3031", "3085", "3072", "6675", "6694", "3302", "6672", "3087", "6673", "3124", "3115", "3091",
  "3032", "3172", "2512", "2523",
  "3057", "1031", "3123", "1053", "1043", "3133", "3086", "3140", "3155", "6670", "3035", "3051", "3144",
  "1029", "1042", "1036", "1028", "1033", "1037", "1038", "2022", "1018",
  "1054", "1055", "1083", "1101", "1102", "1103", "3070",
];

const ASSASSIN = [
  "6609", "3026", "6695", "3179", "3814", "3142", "6035", "6676", "3156", "3074", "3071", "6694",
  "6696", "6701", "6699", "6697", "6610", "6698", "3004", "3146", "2520",
  "1031", "3067", "3123", "1053", "3133", "3134", "3140", "3155", "3035", "2020", "2019", "2021", "6690",
  "1029", "1042", "1036", "1028", "1033", "1037", "1038", "2022",
  "1054", "1055", "1083", "1101", "1102", "1103", "3070",
];

const MAGE = [
  "3041", "3135", "3165", "3157", "3102", "3003", "3100", "3116", "3115", "4628", "4629", "3089",
  "4645", "3871", "3877", "3876", "3870", "3869", "6657", "3152", "3118", "4646", "3137", "6655",
  "6653", "4633", "2503", "4010", "3146", "2522", "2510",
  "3057", "3067", "3916", "3113", "1011", "3191", "3108", "3145", "4632", "4630", "3802", "3803",
  "3147", "2420", "2508",
  "1004", "1029", "1027", "1028", "1052", "1033", "1026", "1058", "2022",
  "1082", "1056", "1054", "3070", "1101", "1102", "1103", "3865",
];

const TANK = [
  "3068", "3109", "3050", "8020", "3110", "3143", "3075", "4401", "3065", "3742", "3083", "3053",
  "3748", "3119", "3121", "3002", "6662", "2502", "6664", "2504", "3084", "6665", "3190", "2501", "2525",
  "3801", "1031", "3066", "3067", "3076", "1011", "1057", "3024", "3082", "6660", "3211", "3077",
  "3044", "3803", "4638", "3105",
  "1029", "1028", "1033", "2022", "1006", "1027",
  "1054", "1055", "1101", "1102", "1103", "3070",
];

const SUPPORT = [
  "3109", "6616", "4643", "3504", "3222", "3107", "3050", "3165", "6620", "2065", "6617", "3190",
  "4005", "8020", "3002", "6621", "3075", "3110", "4401", "3871", "3877", "3876", "3870", "3869",
  "2524", "2526", "2530",
  "3801", "3114", "3066", "3067", "3916", "1057", "3024", "4642", "4641", "4638",
  "1004", "1029", "1027", "1028", "1052", "1033", "1026", "2022",
  "3865", "1101", "1102", "1103", "3867",
];

export const CLASS_ITEM_IDS: Record<ShopClassId, Set<string>> = {
  fighter: new Set([...FIGHTER, ...CONSUMABLE_IDS]),
  marksman: new Set([...MARKSMAN, ...CONSUMABLE_IDS]),
  assassin: new Set([...ASSASSIN, ...CONSUMABLE_IDS]),
  mage: new Set([...MAGE, ...CONSUMABLE_IDS]),
  tank: new Set([...TANK, ...CONSUMABLE_IDS]),
  support: new Set([...SUPPORT, ...CONSUMABLE_IDS]),
};

export const WHITELIST = new Set(
  Object.values(CLASS_ITEM_IDS).flatMap((set) => [...set]),
);

export interface ShopItemLike {
  id: string;
  totalGold: number;
  tags: string[];
}

export function isShopBoots(item: ShopItemLike): boolean {
  return item.tags.includes("Boots") && !BOOTS_BLACKLIST.has(item.id);
}

// Whether the shop grid shows this item at all: the curated whitelist,
// plus every real pair of boots.
export function isShopItem(item: ShopItemLike): boolean {
  if (BLACKLISTED_IDS.has(item.id)) return false;
  return (WHITELIST.has(item.id) && item.totalGold > 0) || isShopBoots(item);
}

export type ShopGroupId = "legendary" | "epic" | "basic" | "starter" | "boots" | "consumable";

export const SHOP_GROUP_ORDER: ShopGroupId[] = ["legendary", "epic", "basic", "starter", "boots", "consumable"];

export function shopGroupOf(item: ShopItemLike): ShopGroupId {
  if (CONSUMABLE_IDS.has(item.id)) return "consumable";
  if (STARTER_IDS.has(item.id)) return "starter";
  if (isShopBoots(item)) return "boots";
  if (BASIC_IDS.has(item.id)) return "basic";
  if (EPIC_OVERRIDES.has(item.id)) return "epic";
  if (LEGENDARY_OVERRIDES.has(item.id) || item.totalGold > EPIC_LEGENDARY_BREAKPOINT) return "legendary";
  return "epic";
}
