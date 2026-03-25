import { describe, it, expect } from "vitest";

import {
  findAliasAtOffset,
  findAliasUsageAtOffset,
  collectAliasRanges,
} from "../server/src/utils/alias-rename.utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PIPE = `{
  "_id": "my-pipe",
  "source": {
    "type": "dataset",
    "datasets": ["wikidata-classification-transform wct", "other-dataset od"]
  },
  "transform": {
    "rules": {
      "default": [
        ["add", "name", ["path", "wct.name"]],
        ["add", "id", "_S.wct.$ids"],
        ["add", "prefixed", "wct.$ids"],
        ["add", "bare", "wct"],
        ["add", "second", ["path", "od.name"]]
      ]
    }
  }
}`;

// ---------------------------------------------------------------------------
// findAliasAtOffset
// ---------------------------------------------------------------------------

describe("findAliasAtOffset", () => {
  it("returns null when cursor is on the dataset-id portion", () => {
    // cursor on "wikidata" in "wikidata-classification-transform wct"
    const target = '"wikidata-classification-transform wct"';
    const idx = PIPE.indexOf(target);
    const result = findAliasAtOffset(PIPE, idx + 1); // inside 'wikidata…'
    expect(result).toBeNull();
  });

  it("returns AliasRef when cursor is on the alias token", () => {
    const target = '"wikidata-classification-transform wct"';
    const idx = PIPE.indexOf(target);
    // place cursor on the 'w' of 'wct' (at the end of the string)
    const aliasOffset = idx + target.indexOf("wct");
    const result = findAliasAtOffset(PIPE, aliasOffset);
    expect(result).not.toBeNull();
    expect(result!.alias).toBe("wct");
    expect(result!.datasetId).toBe("wikidata-classification-transform");
  });

  it("returns null when cursor is completely outside string quotes", () => {
    const result = findAliasAtOffset(PIPE, 0); // start of file
    expect(result).toBeNull();
  });

  it("returns null for a single-token string (no alias)", () => {
    const target = '"my-pipe"';
    const idx = PIPE.indexOf(target);
    const result = findAliasAtOffset(PIPE, idx + 2);
    expect(result).toBeNull();
  });

  it("returns null when string is outside a datasets array", () => {
    // "default" key is not inside datasets
    const target = '"default"';
    const idx = PIPE.indexOf(target);
    const result = findAliasAtOffset(PIPE, idx + 2);
    expect(result).toBeNull();
  });

  it("can detect the second alias in the datasets array", () => {
    const target = '"other-dataset od"';
    const idx = PIPE.indexOf(target);
    const aliasOffset = idx + target.indexOf("od");
    const result = findAliasAtOffset(PIPE, aliasOffset);
    expect(result).not.toBeNull();
    expect(result!.alias).toBe("od");
    expect(result!.datasetId).toBe("other-dataset");
  });
});

// ---------------------------------------------------------------------------
// findAliasUsageAtOffset
// ---------------------------------------------------------------------------

describe("findAliasUsageAtOffset", () => {
  it("detects cursor on prefixed usage 'wct.name'", () => {
    const target = '"wct.name"';
    const idx = PIPE.indexOf(target);
    const result = findAliasUsageAtOffset(PIPE, idx + 2); // on 'w'
    expect(result).not.toBeNull();
    expect(result!.alias).toBe("wct");
    expect(result!.datasetId).toBe("wikidata-classification-transform");
  });

  it("detects cursor on $ids prefixed usage 'wct.$ids'", () => {
    const target = '"wct.$ids"';
    const idx = PIPE.indexOf(target);
    const result = findAliasUsageAtOffset(PIPE, idx + 2);
    expect(result).not.toBeNull();
    expect(result!.alias).toBe("wct");
  });

  it("detects cursor on bare alias usage", () => {
    // "bare" value equals "wct"
    const target = '"bare", "wct"';
    const startSearch = PIPE.indexOf(target);
    // Position of "wct" standalone value
    const bareOffset = PIPE.indexOf('"wct"', startSearch) + 2;
    const result = findAliasUsageAtOffset(PIPE, bareOffset);
    expect(result).not.toBeNull();
    expect(result!.alias).toBe("wct");
  });

  it("returns null when the word has no declaration", () => {
    // "name" is not a declared alias
    const target = '"name"';
    const idx = PIPE.indexOf(target);
    const result = findAliasUsageAtOffset(PIPE, idx + 2);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectAliasRanges
// ---------------------------------------------------------------------------

describe("collectAliasRanges", () => {
  it("finds the declaration range", () => {
    const ranges = collectAliasRanges(PIPE, "wct");
    // Declaration: "wikidata-classification-transform wct"
    const declTarget = '"wikidata-classification-transform wct"';
    const expectedStart = PIPE.indexOf(declTarget) + declTarget.indexOf("wct");
    const decl = ranges.find((r) => r.start === expectedStart);
    expect(decl).toBeDefined();
    expect(decl!.end - decl!.start).toBe("wct".length);
  });

  it("finds prefixed usage wct.name", () => {
    const ranges = collectAliasRanges(PIPE, "wct");
    const target = '"wct.name"';
    const expectedStart = PIPE.indexOf(target) + 1;
    const usage = ranges.find((r) => r.start === expectedStart);
    expect(usage).toBeDefined();
  });

  it("finds prefixed usage wct.$ids", () => {
    const ranges = collectAliasRanges(PIPE, "wct");
    const target = '"wct.$ids"';
    const expectedStart = PIPE.indexOf(target) + 1;
    const usage = ranges.find((r) => r.start === expectedStart);
    expect(usage).toBeDefined();
  });

  it("finds bare 'wct' usage", () => {
    const ranges = collectAliasRanges(PIPE, "wct");
    // The "bare" entry has value "wct"
    const bareTarget = '"wct"';
    const lastIdx = PIPE.lastIndexOf(bareTarget);
    const expectedStart = lastIdx + 1;
    const bare = ranges.find((r) => r.start === expectedStart);
    expect(bare).toBeDefined();
  });

  it("does not include non-alias strings", () => {
    const ranges = collectAliasRanges(PIPE, "wct");
    // None of the ranges should point to "_id" or "my-pipe"
    const myPipeStart = PIPE.indexOf('"my-pipe"') + 1;
    expect(ranges.find((r) => r.start === myPipeStart)).toBeUndefined();
  });

  it("returns empty array for unknown alias", () => {
    const ranges = collectAliasRanges(PIPE, "zzz");
    expect(ranges).toHaveLength(0);
  });

  it("collects all 'od' alias occurrences independently", () => {
    const ranges = collectAliasRanges(PIPE, "od");
    // Declaration "other-dataset od" + usage "od.name"
    expect(ranges.length).toBeGreaterThanOrEqual(2);
  });
});
