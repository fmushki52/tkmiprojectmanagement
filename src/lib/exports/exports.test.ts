import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes fields with commas, quotes and newlines and uses CRLF with a BOM", () => {
    const out = toCsv([["a", "b,c", 'say "hi"', "line1\nline2"], [1, null, 2.5, true]]);
    expect(out).toBe('﻿a,"b,c","say ""hi""","line1\nline2"\r\n1,,2.5,true\r\n');
  });
  it("neutralises spreadsheet formulas in text but leaves numbers alone", () => {
    const out = toCsv([["=HYPERLINK(\"http://evil\")", "+1", "-2", "@x", "ok", -5]]);
    expect(out).toBe('﻿"\'=HYPERLINK(""http://evil"")",\'+1,\'-2,\'@x,ok,-5\r\n');
  });
});
