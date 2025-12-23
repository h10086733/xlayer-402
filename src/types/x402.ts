export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter?: string;
  validBefore?: string;
  nonce: string;
}

export interface Payload {
  signature: string;
  authorization: Authorization;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  chainIndex: string;
  payload: Payload;
}

export interface PaymentRequirements {
  scheme: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxAmountRequired: string;
  maxTimeoutSeconds?: number;
  payTo: string;
  asset?: string;
  outputSchema?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface SupportedChain {
  x402Version: number;
  scheme: string;
  chainIndex: string;
  chainName: string;
}

export interface SettleRequestBody {
  x402Version: number;
  chainIndex: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyRequestBody extends SettleRequestBody {}

export interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T;
}

export interface SettlementResult {
  chainIndex: string;
  chainName: string;
  success: boolean;
  payer: string;
  txHash: string;
  errorMsg?: string | null;
}

export interface VerificationResult {
  isValid: boolean;
  payer: string;
  invalidReason?: string | null;
}
