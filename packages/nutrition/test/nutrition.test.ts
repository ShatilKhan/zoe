import { describe, expect, it } from "vitest";
import { calculateNutrition, matchFood, parseExplicitGrams } from "../src/index";

describe("nutrition arithmetic", () => {
  it("scales pinned values by reviewed grams", () => {
    expect(calculateNutrition([{ foodId: "demo-rice-v1", grams: 200 }])).toMatchObject({ kcal: 260, carbsG: 56.3 });
  });

  it("matches Bengali aliases locally", () => {
    expect(matchFood("আজ ভাত এবং ডাল").map((food) => food.id)).toEqual(["demo-rice-v1", "demo-lentils-v1"]);
  });

  it("rejects implausible portions", () => {
    expect(() => calculateNutrition([{ foodId: "demo-rice-v1", grams: -1 }])).toThrow();
  });

  it("uses only an explicit unambiguous gram amount", () => {
    expect(parseExplicitGrams("I ate 175 g rice")).toBe(175);
    expect(parseExplicitGrams("rice and dal")).toBeNull();
    expect(parseExplicitGrams("100 g rice and 80 g dal")).toBeNull();
  });
});
