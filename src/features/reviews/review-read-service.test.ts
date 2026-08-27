import { describe, expect, test } from "vitest";

import { attachCitationProvenance, parseStoredReviewCitations } from "./review-read-service";

const itemId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000002";
const retrievalRecordId = "30000000-0000-4000-8000-000000000003";

describe("stored review citation compatibility", () => {
  test("parses exact citation pairs without changing their order", () => {
    expect(parseStoredReviewCitations([{ itemId, sourceId }])).toEqual({
      citationMode: "exact",
      citations: [{ itemId, sourceId }],
      legacySourceIds: [],
    });
  });

  test("keeps legacy source ids source-level instead of fabricating item ids", () => {
    expect(parseStoredReviewCitations([sourceId])).toEqual({
      citationMode: "legacy",
      citations: [],
      legacySourceIds: [sourceId],
    });
  });

  test("rejects malformed stored evidence", () => {
    expect(() => parseStoredReviewCitations([{ sourceId }])).toThrow("INVALID_REVIEW_CITATIONS");
    expect(() => parseStoredReviewCitations(["private/object-key"])).toThrow("INVALID_REVIEW_CITATIONS");
  });

  test("inherits the retrieval snapshot across an exact manual child version", () => {
    const reports = attachCitationProvenance([
      { version: 2, parentVersion: 1, retrievalRecordId: null },
      { version: 1, parentVersion: null, retrievalRecordId },
    ]);

    expect(reports[0]).toMatchObject({ citationRetrievalRecordId: retrievalRecordId });
    expect(reports[1]).toMatchObject({ citationRetrievalRecordId: retrievalRecordId });
  });
});
