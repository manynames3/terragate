import assert from "node:assert/strict";
import test from "node:test";
import {formatRisk} from "./format.ts";

test("risk labels distinguish a real zero from missing and failed assessments",()=>{
  assert.equal(formatRisk(0,"low"),"low (0/100)");
  assert.equal(formatRisk(null,"not_assessed"),"Not assessed");
  assert.equal(formatRisk(null,"unavailable"),"Unavailable");
  assert.equal(formatRisk(87,"critical"),"critical (87/100)");
});
