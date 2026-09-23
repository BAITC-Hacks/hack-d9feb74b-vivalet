import { z } from "zod";
import { authorityTypes, changeTypes } from "../types";

export const functionSchema = z.object({
  chunkId: z.string(), quote: z.string(), actor: z.string(), organizationalUnit: z.string().nullable(),
  action: z.string(), object: z.string(), target: z.string().nullable(), purpose: z.string().nullable(),
  scope: z.array(z.string()), authorityType: z.enum(authorityTypes), conditions: z.array(z.string()),
  recipients: z.array(z.string()), domain: z.string().nullable(),
});
export const unitSchema = z.object({ name: z.string(), chunkId: z.string(), quote: z.string(), abbreviation: z.string().nullable(), parentUnit: z.string().nullable(), leaderRole: z.string().nullable(), roles: z.array(z.string()) });
export const extractionSchema = z.object({ functions: z.array(functionSchema), units: z.array(unitSchema) });
export type ExtractedFunction = z.infer<typeof functionSchema>;
export const decisionSchema = z.object({
  oldFunctionIds: z.array(z.string()), newFunctionIds: z.array(z.string()), changeTypes: z.array(z.enum(changeTypes)),
  meaningPreserved: z.boolean(), oldCoveredByNew: z.boolean(), newCoveredByOld: z.boolean(),
  actorChanged: z.boolean(), authorityChanged: z.boolean(), scopeChanged: z.boolean(),
  conditionsChanged: z.boolean(), purposeChanged: z.boolean(), coverageScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1), reasoning: z.string(), requiresHumanReview: z.boolean(),
});
export const criticSchema = z.object({
  status: z.enum(["SUPPORTED", "REFUTED", "UNCERTAIN"]), reason: z.string(),
  evidence: z.array(z.object({ documentId: z.string(), chunkId: z.string(), quote: z.string() })),
});
