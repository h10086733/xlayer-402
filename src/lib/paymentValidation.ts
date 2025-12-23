/**
 * 支付验证工具函数
 */

export interface PaymentValidationResult {
  valid: boolean;
  reason?: string;
  expectedAmount?: number;
  actualAmount?: number;
}

export interface AssetConfig {
  address: string;
  symbol: string;
  decimals: number;
}

// 常用资产配置
export const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  'USDC': {
    address: process.env.USDC_CONTRACT_ADDRESS || '0xa0b86a33e6ba3cf1eff95a6d9dd3ae4e26169a95', // X Layer USDC
    symbol: 'USDC',
    decimals: 6
  },
  'ETH': {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH', 
    decimals: 18
  }
};

/**
 * 验证支付金额是否正确
 * @param paidAmount 用户支付的金额（可能是 Wei 单位或标准单位）
 * @param requiredAmount 要求的金额（标准单位，如 1.5 USDC）
 * @param assetAddress 支付的资产合约地址
 * @param tolerancePercent 允许的误差百分比，默认 0.1%
 * @param isWeiAmount 指定 paidAmount 是否为 Wei 单位，默认自动检测
 */
export function validatePaymentAmount(
  paidAmount: number,
  requiredAmount: number,
  assetAddress?: string,
  tolerancePercent: number = 0.1,
  isWeiAmount?: boolean
): PaymentValidationResult {
  // 获取资产配置
  const asset = findAssetByAddress(assetAddress);
  if (!asset) {
    return {
      valid: false,
      reason: `不支持的支付资产: ${assetAddress}`
    };
  }

  let actualAmount: number;
  
  if (isWeiAmount === undefined) {
    // 自动检测：如果金额远大于要求金额，可能是 Wei 单位
    const potentialWeiAmount = convertWeiToStandardUnit(paidAmount, asset.decimals);
    const directAmount = paidAmount;
    
    // 选择更接近要求金额的那个
    const weiDiff = Math.abs(potentialWeiAmount - requiredAmount);
    const directDiff = Math.abs(directAmount - requiredAmount);
    
    if (weiDiff < directDiff) {
      actualAmount = potentialWeiAmount;
      console.log(`自动检测: 将金额 ${paidAmount} 识别为 Wei 单位，转换为 ${actualAmount} ${asset.symbol}`);
    } else {
      actualAmount = directAmount;
      console.log(`自动检测: 将金额 ${paidAmount} 识别为标准单位 ${asset.symbol}`);
    }
  } else if (isWeiAmount) {
    // 明确指定为 Wei 单位，需要转换
    actualAmount = convertWeiToStandardUnit(paidAmount, asset.decimals);
    console.log(`Wei 转换: ${paidAmount} Wei -> ${actualAmount} ${asset.symbol}`);
  } else {
    // 明确指定为标准单位，直接使用
    actualAmount = paidAmount;
    console.log(`标准单位: ${actualAmount} ${asset.symbol}`);
  }
  
  console.log(`支付验证: 实际支付=${actualAmount} ${asset.symbol}, 要求=${requiredAmount} ${asset.symbol}`);
  
  // 计算误差
  const tolerance = Math.max((tolerancePercent / 100) * requiredAmount, 0.001); // 最小容忍度 0.001
  const amountDiff = Math.abs(actualAmount - requiredAmount);
  
  if (amountDiff <= tolerance) {
    return {
      valid: true,
      expectedAmount: requiredAmount,
      actualAmount
    };
  } else {
    return {
      valid: false,
      reason: `支付金额不正确。要求: ${requiredAmount} ${asset.symbol}, 实际: ${actualAmount} ${asset.symbol} (误差: ${amountDiff.toFixed(6)})`,
      expectedAmount: requiredAmount,
      actualAmount
    };
  }
}

/**
 * 根据合约地址查找资产配置
 */
function findAssetByAddress(address?: string): AssetConfig | null {
  if (!address) {
    // 默认返回 USDC 配置
    return SUPPORTED_ASSETS.USDC;
  }

  const normalizedAddress = address.toLowerCase();
  
  for (const asset of Object.values(SUPPORTED_ASSETS)) {
    if (asset.address.toLowerCase() === normalizedAddress) {
      return asset;
    }
  }
  
  return null;
}

/**
 * 将 Wei 金额转换为标准单位
 * @param weiAmount Wei 金额
 * @param decimals 小数位数
 */
function convertWeiToStandardUnit(weiAmount: number, decimals: number): number {
  return weiAmount / Math.pow(10, decimals);
}

/**
 * 将标准单位转换为 Wei
 * @param standardAmount 标准金额
 * @param decimals 小数位数
 */
export function convertStandardUnitToWei(standardAmount: number, decimals: number): number {
  return Math.round(standardAmount * Math.pow(10, decimals));
}

/**
 * 验证资产类型是否正确
 */
export function validateAssetType(
  paidAssetAddress?: string,
  expectedAssetType: string = 'USDC'
): PaymentValidationResult {
  const expectedAsset = SUPPORTED_ASSETS[expectedAssetType];
  
  if (!expectedAsset) {
    return {
      valid: false,
      reason: `不支持的期望资产类型: ${expectedAssetType}`
    };
  }
  
  if (!paidAssetAddress) {
    // 如果没有指定支付资产，假设是默认资产
    return {
      valid: true
    };
  }
  
  const normalizedPaid = paidAssetAddress.toLowerCase();
  const normalizedExpected = expectedAsset.address.toLowerCase();
  
  if (normalizedPaid === normalizedExpected) {
    return {
      valid: true
    };
  } else {
    return {
      valid: false,
      reason: `支付资产类型不正确。要求: ${expectedAssetType} (${expectedAsset.address}), 实际: ${paidAssetAddress}`
    };
  }
}

/**
 * 格式化金额显示
 */
export function formatAmount(amount: number, decimals: number = 6): string {
  return amount.toFixed(decimals);
}