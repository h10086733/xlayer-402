import { z } from 'zod';

export const authorizationSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  value: z.string().min(1),
  validAfter: z.string().optional(),
  validBefore: z.string().optional(),
  nonce: z.string().min(1)
});

export const payloadSchema = z.object({
  signature: z.string().min(1),
  authorization: authorizationSchema
});

export const paymentPayloadSchema = z.object({
  x402Version: z.number(),
  scheme: z.string().min(1),
  chainIndex: z.string().min(1),
  payload: payloadSchema
});

export const paymentRequirementsSchema = z.object({
  scheme: z.string().min(1),
  chainIndex: z.string().min(1),
  resource: z.string().url().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  maxAmountRequired: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive().optional(),
  payTo: z.string().min(1),
  asset: z.string().optional(),
  outputSchema: z.record(z.any()).optional(),
  extra: z.record(z.any()).optional()
});

export const x402RequestSchema = z.object({
  x402Version: z.number(),
  chainIndex: z.string().min(1),
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema
});

export type X402RequestBody = z.infer<typeof x402RequestSchema>;
