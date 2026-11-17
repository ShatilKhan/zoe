export type RecordKind = "allergy" | "condition" | "medicine" | "visit" | "note";
export type RecordSource = "patient-reported" | "photo-transcribed" | "clinician-note";

export interface PatientRecord {
  id: string;
  kind: RecordKind;
  title: string;
  detail: string;
  recordedAt: string;
  author: "patient";
  source: RecordSource;
  status: "confirmed" | "draft";
}

export interface RecordCitation {
  sourceId: string;
  label: string;
}

export interface RecordAnswer {
  text: string;
  citations: RecordCitation[];
  gaps: string[];
  urgent: boolean;
}

export const SYNTHETIC_RECORDS: PatientRecord[] = [
  {
    id: "rec-allergy-penicillin",
    kind: "allergy",
    title: "Penicillin allergy",
    detail: "Synthetic demo: rash reported after penicillin in 2022.",
    recordedAt: "2026-10-04T09:30:00.000Z",
    author: "patient",
    source: "patient-reported",
    status: "confirmed"
  },
  {
    id: "rec-med-metformin",
    kind: "medicine",
    title: "Metformin 500 mg",
    detail: "Synthetic demo: one tablet with the evening meal.",
    recordedAt: "2026-11-02T15:00:00.000Z",
    author: "patient",
    source: "photo-transcribed",
    status: "confirmed"
  }
];

const URGENT_PATTERN = /(?:chest pain|cannot breathe|can't breathe|unconscious|severe bleeding|suicid|overdose)/i;
const GREETING_PATTERN = /^(?:hi|hello|hey|salam|assalamu alaikum|হাই|হ্যালো)[!. ]*$/i;

export function answerFromRecords(question: string, records: PatientRecord[]): RecordAnswer {
  const query = question.trim();
  if (URGENT_PATTERN.test(query)) {
    return {
      text: "This may need urgent help. Contact local emergency services now or ask someone nearby to help. Zoe cannot assess an emergency.",
      citations: [],
      gaps: ["No emergency assessment is performed."],
      urgent: true
    };
  }

  if (GREETING_PATTERN.test(query)) {
    return {
      text: "Hello — I can help you find confirmed records, review medicine information, or estimate nutrients from a meal.",
      citations: [],
      gaps: [],
      urgent: false
    };
  }

  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
  const matches = records
    .filter((record) => record.status === "confirmed")
    .map((record) => ({
      record,
      score: terms.reduce((score, term) => score + (`${record.kind} ${record.title} ${record.detail}`.toLocaleLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ record }) => record);

  if (matches.length === 0) {
    return {
      text: "I could not find a confirmed record that answers that. You can add a record or ask with the medicine or condition name.",
      citations: [],
      gaps: ["No matching confirmed record."],
      urgent: false
    };
  }

  return {
    text: matches.map((record) => `${record.title}: ${record.detail}`).join("\n"),
    citations: matches.map((record) => ({ sourceId: record.id, label: `${record.title} · ${record.source}` })),
    gaps: ["This answer uses saved records only; it does not check interactions or decide treatment."],
    urgent: false
  };
}

export function createDraftRecord(input: Omit<PatientRecord, "id" | "author" | "status">): PatientRecord {
  const title = input.title.trim();
  const detail = input.detail.trim();
  if (!title || !detail) throw new Error("Record title and detail are required.");
  return {
    ...input,
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    detail,
    author: "patient",
    status: "draft"
  };
}

export function confirmRecord(record: PatientRecord): PatientRecord {
  if (record.status !== "draft") throw new Error("Only a reviewed draft can be confirmed.");
  if (!record.title.trim() || !record.detail.trim()) throw new Error("Record title and detail are required.");
  return { ...record, status: "confirmed" };
}
