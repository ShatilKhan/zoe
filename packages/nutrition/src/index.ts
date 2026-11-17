export interface FoodEntry {
  id: string;
  name: string;
  aliases: string[];
  source: string;
  per100g: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
}

export interface MealItem {
  foodId: string;
  grams: number;
}

export interface NutritionTotal {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  citations: { foodId: string; source: string; grams: number }[];
}

export const DEMO_FOODS: FoodEntry[] = [
  { id: "demo-rice-v1", name: "Cooked white rice", aliases: ["rice", "ভাত"], source: "App-authored synthetic demo catalog v1; not a USDA record", per100g: { kcal: 130, proteinG: 2.69, carbsG: 28.17, fatG: 0.28, fiberG: 0.4 } },
  { id: "demo-lentils-v1", name: "Cooked lentils", aliases: ["lentils", "dal", "ডাল"], source: "App-authored synthetic demo catalog v1; not a USDA record", per100g: { kcal: 116, proteinG: 9.02, carbsG: 20.13, fatG: 0.38, fiberG: 7.9 } },
  { id: "demo-banana-v1", name: "Banana", aliases: ["banana", "কলা"], source: "App-authored synthetic demo catalog v1; not a USDA record", per100g: { kcal: 89, proteinG: 1.09, carbsG: 22.84, fatG: 0.33, fiberG: 2.6 } }
];

function round(value: number, digits = 1) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function calculateNutrition(items: MealItem[], catalog: FoodEntry[] = DEMO_FOODS): NutritionTotal {
  if (items.length === 0) throw new Error("At least one meal item is required.");
  const result: NutritionTotal = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, citations: [] };
  for (const item of items) {
    if (!Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 5000) throw new Error("Food weight must be between 0 and 5000 grams.");
    const food = catalog.find((entry) => entry.id === item.foodId);
    if (!food) throw new Error(`Unknown food: ${item.foodId}`);
    const ratio = item.grams / 100;
    result.kcal += food.per100g.kcal * ratio;
    result.proteinG += food.per100g.proteinG * ratio;
    result.carbsG += food.per100g.carbsG * ratio;
    result.fatG += food.per100g.fatG * ratio;
    result.fiberG += food.per100g.fiberG * ratio;
    result.citations.push({ foodId: food.id, source: food.source, grams: item.grams });
  }
  return { ...result, kcal: round(result.kcal, 0), proteinG: round(result.proteinG), carbsG: round(result.carbsG), fatG: round(result.fatG), fiberG: round(result.fiberG) };
}

export function matchFood(text: string, catalog: FoodEntry[] = DEMO_FOODS): FoodEntry[] {
  const normalized = text.toLocaleLowerCase();
  return catalog.filter((food) => [food.name, ...food.aliases].some((name) => normalized.includes(name.toLocaleLowerCase())));
}

export function parseExplicitGrams(text: string): number | null {
  const matches = [...text.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:g|gram|grams)(?:\s|$)/gi)];
  if (matches.length !== 1) return null;
  const grams = Number(matches[0]?.[1]);
  return Number.isFinite(grams) && grams > 0 && grams <= 5000 ? grams : null;
}
