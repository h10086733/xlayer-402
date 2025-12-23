/**
 * X402 配置验证工具
 * 验证支付信息是否与环境配置的 X402 参数匹配
 */

// 定义支付接口（原来在数据库模块中）
export interface X402Payment {
  id?: number;
  x402_version: number;
  chain_index: string;
  scheme: string;
  from_address: string;
  to_address: string;
  asset?: string;
  value: number;
  nonce: string;
  signature: string;
  valid_after?: number;
  valid_before?: number;
  resource?: string;
  description?: string;
  mime_type?: string;
  output_schema?: object;
  extra?: object;
  template_id?: string;
  is_template_paid?: boolean;
  status?: 'pending' | 'paid' | 'failed';
  max_amount_required?: number;
  created_at?: string;
  updated_at?: string;
}
import { validatePaymentAmount, validateAssetType } from './paymentValidation';

export interface X402ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface X402Config {
  version: number;
  chainIndex: string;
  scheme: string;
  payTo: string;
  maxAmount: number;
  asset: string;
  value: number;
  resource?: string;
  description?: string;
  mimeType?: string;
}

/**
 * 从环境变量加载 X402 配置
 */
export function loadX402Config(): X402Config {
  return {
    version: parseInt(process.env.X402_VERSION || '1'),
    chainIndex: process.env.X402_CHAIN_INDEX || '196',
    scheme: process.env.X402_SCHEME || 'exact',
    payTo: process.env.X402_PAY_TO || '',
    maxAmount: parseFloat(process.env.X402_MAX_AMOUNT || '1000000000000'),
    asset: process.env.X402_ASSET || '',
    value: parseFloat(process.env.X402_VALUE || '1000000000000'),
    resource: process.env.X402_RESOURCE,
    description: process.env.X402_DESCRIPTION,
    mimeType: process.env.X402_MIME_TYPE || 'application/json'
  };
}

/**
 * 验证支付记录是否符合 X402 配置要求
 */
export function validateX402Payment(payment: X402Payment): X402ValidationResult {
  const config = loadX402Config();
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log(`🔍 开始 X402 配置验证`);
  console.log(`配置: PAY_TO=${config.payTo}, VALUE=${config.value}`);
  console.log(`支付: TO=${payment.to_address}, VALUE=${payment.value}`);

  // 1. 验证收款地址
  if (config.payTo && payment.to_address.toLowerCase() !== config.payTo.toLowerCase()) {
    errors.push(`收款地址不匹配: 支付到 ${payment.to_address}, 配置收款 ${config.payTo}`);
  }

  
  if (config.value && payment.value !== config.value) {
    errors.push(`支付金额不匹配: 支付到 ${payment.value}, 配置金额 ${config.value}`);
  }
  const result: X402ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings
  };

  console.log(`✅ X402 验证完成: ${result.valid ? '通过' : '失败'}`);
  if (result.errors.length > 0) {
    console.error(`验证错误:`, result.errors);
  }
  if (result.warnings.length > 0) {
    console.warn(`验证警告:`, result.warnings);
  }

  return result;
}

/**
 * 获取 X402 配置用于客户端显示
 */
export function getX402ConfigForClient(): Partial<X402Config> {
  const config = loadX402Config();
  
  return {
    version: config.version,
    chainIndex: config.chainIndex,
    scheme: config.scheme,
    payTo: config.payTo,
    maxAmount: config.maxAmount,
    asset: config.asset,
    value: config.value,
    mimeType: config.mimeType
  };
}

/**
 * 格式化验证结果为用户友好的消息
 */
export function formatValidationMessage(result: X402ValidationResult): string {
  if (result.valid) {
    return '✅ X402 配置验证通过';
  }

  let message = '❌ X402 配置验证失败:\n';
  result.errors.forEach((error, index) => {
    message += `${index + 1}. ${error}\n`;
  });

  if (result.warnings.length > 0) {
    message += '\n⚠️ 警告:\n';
    result.warnings.forEach((warning, index) => {
      message += `${index + 1}. ${warning}\n`;
    });
  }

  return message.trim();
}