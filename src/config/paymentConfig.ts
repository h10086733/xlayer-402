import { z } from 'zod';

const numberFromEnv = (value?: string) => (value ? Number(value) : undefined);

export const paymentRequestSchema = z.object({
  x402Version: z.number().default(1),
  chainIndex: z.string().default('196'),
  scheme: z.string().default('exact'),
  payTo: z.string().default(''),
  maxAmountRequired: z.string().default('0'),
  resource: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  asset: z.string().optional(),
  tokenContract: z.string().optional(),
  value: z.string().default('0'),
  validitySeconds: z.number().default(600),
  validStartLeadSeconds: z.number().default(60),
  maxTimeoutSeconds: z.number().default(10),
  gasLimit: z.string().default('100000')
});

const paymentOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  request: paymentRequestSchema
});

const configSchema = z.object({
  defaultOptionId: z.string().optional(),
  options: z.array(paymentOptionSchema).min(1)
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;
export type PaymentOption = z.infer<typeof paymentOptionSchema>;

const cloneRequest = (request: PaymentRequest): PaymentRequest => ({ ...request });

const multiplyStringValue = (value?: string, factor = 1n) => {
  try {
    const numeric = BigInt(value ?? '0');
    return (numeric * factor).toString();
  } catch {
    return value ?? '0';
  }
};

const loadBaseRequest = () =>
  paymentRequestSchema.parse({
    x402Version: numberFromEnv(process.env.X402_VERSION),
    chainIndex: process.env.X402_CHAIN_INDEX,
    scheme: process.env.X402_SCHEME,
    payTo: process.env.X402_PAY_TO,
    maxAmountRequired: process.env.X402_MAX_AMOUNT,
    resource: process.env.X402_RESOURCE,
    description: process.env.X402_DESCRIPTION,
    mimeType: process.env.X402_MIME_TYPE,
    asset: process.env.X402_ASSET,
    tokenContract: process.env.X402_ASSET,
    value: process.env.X402_VALUE,
    validitySeconds: numberFromEnv(process.env.X402_VALID_SECONDS),
    validStartLeadSeconds: numberFromEnv(process.env.X402_VALID_LEAD_SECONDS),
    maxTimeoutSeconds: numberFromEnv(process.env.X402_MAX_TIMEOUT_SECONDS),
    gasLimit: process.env.X402_GAS_LIMIT
  });

const createBuiltInOptions = (baseRequest: PaymentRequest): PaymentOption[] => {
  const defaultLabel = process.env.X402_LABEL ?? '空投模板（标准）';
  const sharedDescription = process.env.X402_DESCRIPTION ?? '基于 .env 的支付配置';
  const doubleValue = multiplyStringValue(baseRequest.value, 2n);
  const doubleMaxAmount = multiplyStringValue(baseRequest.maxAmountRequired, 2n);

  const standardOption: PaymentOption = {
    id: 'airdrop-basic',
    label: defaultLabel,
    description: sharedDescription,
    request: cloneRequest(baseRequest)
  };

  const premiumOption: PaymentOption = {
    id: 'airdrop-premium',
    label: '空投模板（高级）',
    description: '额度翻倍并延长有效期，适合大额空投或奖励发放',
    request: {
      ...cloneRequest(baseRequest),
      value: doubleValue,
      maxAmountRequired: doubleMaxAmount,
      validitySeconds: baseRequest.validitySeconds * 2,
      maxTimeoutSeconds: Math.max(baseRequest.maxTimeoutSeconds, 20),
      description: baseRequest.description ?? '双倍额度空投任务',
      resource: process.env.X402_PREMIUM_RESOURCE ?? baseRequest.resource,
      gasLimit: process.env.X402_GAS_LIMIT_PREMIUM ?? baseRequest.gasLimit
    }
  };

  const tokenMintOption: PaymentOption = {
    id: 'token-mint',
    label: '代币铸造模板',
    description: '适合代币铸造，支持配置铸造次数和进度查询',
    request: {
      ...cloneRequest(baseRequest),
      description: process.env.X402_TOKEN_DESCRIPTION ?? '代币铸造权限',
      resource: process.env.X402_TOKEN_RESOURCE ?? baseRequest.resource,
      mimeType: process.env.X402_TOKEN_MIME_TYPE ?? baseRequest.mimeType,
      validStartLeadSeconds: baseRequest.validStartLeadSeconds ?? 0,
      validitySeconds: Math.max(baseRequest.validitySeconds, 900),
      gasLimit: process.env.X402_TOKEN_GAS_LIMIT ?? (Number(baseRequest.gasLimit) ? String(Number(baseRequest.gasLimit) + 30000) : baseRequest.gasLimit)
    }
  };

  const subscriptionOption: PaymentOption = {
    id: 'subscription-basic',
    label: '订阅模板',
    description: '面向 API/会员的周期内多次调用配置',
    request: {
      ...cloneRequest(baseRequest),
      value: process.env.X402_SUBSCRIPTION_VALUE ?? baseRequest.value,
      maxAmountRequired: process.env.X402_SUBSCRIPTION_MAX_AMOUNT ?? baseRequest.maxAmountRequired,
      validitySeconds: Math.max(baseRequest.validitySeconds, 3600),
      maxTimeoutSeconds: Math.max(baseRequest.maxTimeoutSeconds, 30),
      description: process.env.X402_SUBSCRIPTION_DESCRIPTION ?? '订阅制付费资源',
      resource: process.env.X402_SUBSCRIPTION_RESOURCE ?? baseRequest.resource
    }
  };

  return [standardOption, premiumOption, tokenMintOption, subscriptionOption];
};

const parseOptionsFromEnv = () => {
  const json = process.env.X402_OPTIONS_JSON;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    const result = z.array(paymentOptionSchema).parse(parsed);
    return result;
  } catch (error) {
    console.warn('[x402] 无法解析 X402_OPTIONS_JSON，将回退到默认配置', error);
    return null;
  }
};

const buildConfig = () => {
  const envOptions = parseOptionsFromEnv();
  if (envOptions && envOptions.length > 0) {
    const data = configSchema.parse({
      options: envOptions,
      defaultOptionId: process.env.X402_DEFAULT_OPTION_ID ?? envOptions[0].id
    });
    const hasDefault = data.options.some((opt) => opt.id === data.defaultOptionId);
    return {
      defaultOptionId: hasDefault ? data.defaultOptionId : data.options[0].id,
      options: data.options
    };
  }

  const baseRequest = loadBaseRequest();
  const builtIn = createBuiltInOptions(baseRequest).map((option) => paymentOptionSchema.parse(option));

  return {
    defaultOptionId: builtIn[0].id,
    options: builtIn
  };
};

export const paymentConfig = buildConfig();
export const getPaymentOptionById = (id: string) => paymentConfig.options.find((option) => option.id === id);
