import { describe, expect, it } from "vitest";
import { SYNTHETIC_RECORDS, answerFromRecords, confirmRecord, createDraftRecord, manualRecordKind } from "../src/index";
describe("record retrieval", () => {
  it("returns citations for a matching confirmed fact", () => {
    const answer = answerFromRecords("What medicine am I taking?", SYNTHETIC_RECORDS);
    expect(answer.text).toContain("Metformin");
    expect(answer.citations[0]?.sourceId).toBe("rec-med-metformin");
  });

  it("lists confirmed allergies by type, even when the name contains no allergy keyword", () => {
    const cowMeat = confirmRecord(createDraftRecord({ kind: "allergy", title: "Cow meat", detail: "Synthetic QA reaction.", recordedAt: new Date(0).toISOString(), source: "patient-reported" }));
    const draft = { ...cowMeat, id: "draft", title: "Unconfirmed allergen", status: "draft" } as const;
    const records = [cowMeat, draft, ...SYNTHETIC_RECORDS];
    const answer = answerFromRecords("What are my allergies?", records);
    expect(answer.text).toContain("Cow meat: Synthetic QA reaction.");
    expect(answer.citations.map(({ sourceId }) => sourceId)).toEqual([cowMeat.id, "rec-allergy-penicillin"]);
    expect(answerFromRecords("Show me the source", records, [cowMeat.id]).citations).toEqual([{ sourceId: cowMeat.id, label: "Cow meat · patient-reported" }]);
    expect(answerFromRecords("What are my allergies?", [draft]).text).toMatch(/no confirmed allergy records/i);
    expect(answerFromRecords("Show me the source", [draft], ["draft"]).citations).toEqual([]);
    expect(answerFromRecords("Do I have a cow meat allergy?", records).citations.map(({ sourceId }) => sourceId)).toEqual([cowMeat.id]);
    expect(answerFromRecords("Am I allergic to lobster?", records).citations).toEqual([]);
    expect(answerFromRecords("Do I have a meatball allergy?", records).citations).toEqual([]);
  });

  it("prioritizes urgent language without pretending to assess it", () => {
    const answer = answerFromRecords("I have chest pain", SYNTHETIC_RECORDS);
    expect(answer.urgent).toBe(true);
    expect(answer.citations).toHaveLength(0);
  });

  it("answers English and Bengali greetings without inventing a record", () => {
    for (const greeting of ["Hi", "সালাম"]) {
      const answer = answerFromRecords(greeting, SYNTHETIC_RECORDS);
      expect(answer.text).toMatch(/^Hello/);
      expect(answer.citations).toEqual([]);
    }
  });

  it("rejects empty records", () => {
    expect(() => createDraftRecord({ kind: "note", title: " ", detail: "x", recordedAt: new Date(0).toISOString(), source: "patient-reported" })).toThrow();
  });

  it("keeps new records draft until a separate confirmation", () => {
    const draft = createDraftRecord({ kind: "note", title: "Synthetic note", detail: "Reviewed demo text", recordedAt: new Date(0).toISOString(), source: "patient-reported" });
    expect(draft.status).toBe("draft");
    expect(confirmRecord(draft).status).toBe("confirmed");
    expect(() => confirmRecord({ ...draft, status: "confirmed" })).toThrow();
  });
});

describe("manual record kind", () => {
  it("defaults a generic manual record to note", () => {
    expect(manualRecordKind()).toBe("note");
    expect(manualRecordKind(false)).toBe("note");
  });

  it("uses medicine when manual fallback comes from a prescription", () => {
    expect(manualRecordKind(true)).toBe("medicine");
  });
});
