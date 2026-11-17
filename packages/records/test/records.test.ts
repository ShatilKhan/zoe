import { describe, expect, it } from "vitest";
import { SYNTHETIC_RECORDS, answerFromRecords, confirmRecord, createDraftRecord } from "../src/index";

describe("record retrieval", () => {
  it("returns citations for a matching confirmed fact", () => {
    const answer = answerFromRecords("What medicine am I taking?", SYNTHETIC_RECORDS);
    expect(answer.text).toContain("Metformin");
    expect(answer.citations[0]?.sourceId).toBe("rec-med-metformin");
  });

  it("prioritizes urgent language without pretending to assess it", () => {
    const answer = answerFromRecords("I have chest pain", SYNTHETIC_RECORDS);
    expect(answer.urgent).toBe(true);
    expect(answer.citations).toHaveLength(0);
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
