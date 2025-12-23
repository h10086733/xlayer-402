/**
 * DEX交换服务的统一错误处理器
 */

import { DexError, SwapErrorCode } from './types';

/**
 * 自定义DEX错误类
 */
export class DexSwapError extends Error implements DexError {
  public readonly code: SwapErrorCode;
  public readonly details?: any;
  public readonly suggestions?: string[];
  public readonly timestamp: number;
  public readonly recoverable: boolean;

  constructor(
    code: SwapErrorCode,
    message: string,
    details?: any,
    suggestions?: string[],
    recoverable: boolean = false
  ) {
    super(message);
    this.name = 'DexSwapError';
    this.code = code;
    this.details = details;
    this.suggestions = suggestions;
    this.timestamp = Date.now();
    this.recoverable = recoverable;

    // 确保错误堆栈正确
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DexSwapError);
    }
  }

  /**
   * 将错误转换为用户友好的格式
   */
  public toUserFriendly(): string {
    switch (this.code) {
      case SwapErrorCode.INSUFFICIENT_BALANCE:
        return '余额不足，请检查账户余额';
      
      case SwapErrorCode.INSUFFICIENT_ALLOWANCE:
        return '代币授权不足，需要先进行代币授权';
      
      case SwapErrorCode.SLIPPAGE_EXCEEDED:
        return '滑点过大，请增加滑点容忍度或稍后重试';
      
      case SwapErrorCode.DEADLINE_EXCEEDED:
        return '交易超时，请稍后重试';
      
      case SwapErrorCode.LIQUIDITY_INSUFFICIENT:
        return '流动性不足，无法完成交换';
      
      case SwapErrorCode.PRICE_IMPACT_TOO_HIGH:
        return '价格影响过大，建议减少交换数量';
      
      case SwapErrorCode.NETWORK_ERROR:
        return '网络连接错误，请检查网络连接';
      
      case SwapErrorCode.GAS_ESTIMATION_FAILED:
        return 'Gas估算失败，请稍后重试';
      
      case SwapErrorCode.TRANSACTION_FAILED:
        return '交易执行失败，请查看详细信息';
      
      default:
        return this.message || '未知错误';
    }
  }

  /**
   * 获取建议的解决方案
   */
  public getSuggestions(): string[] {
    if (this.suggestions) {
      return this.suggestions;
    }

    switch (this.code) {
      case SwapErrorCode.INSUFFICIENT_BALANCE:
        return [
          '检查钱包余额是否充足',
          '确认选择了正确的代币和网络',
          '等待之前的交易确认完成'
        ];
      
      case SwapErrorCode.INSUFFICIENT_ALLOWANCE:
        return [
          '点击"授权"按钮进行代币授权',
          '确保钱包有足够的Gas费用支付授权交易',
          '检查授权金额是否足够'
        ];
      
      case SwapErrorCode.SLIPPAGE_EXCEEDED:
        return [
          '增加滑点容忍度到5%或更高',
          '减少交换数量',
          '等待市场波动减少后重试',
          '使用更快的Gas价格'
        ];
      
      case SwapErrorCode.LIQUIDITY_INSUFFICIENT:
        return [
          '减少交换数量',
          '等待流动性改善',
          '尝试其他交换路径',
          '分批次进行小额交换'
        ];
      
      case SwapErrorCode.NETWORK_ERROR:
        return [
          '检查网络连接',
          '刷新页面重试',
          '切换到其他RPC端点',
          '稍后重试'
        ];
      
      default:
        return ['请稍后重试', '如问题持续，请联系技术支持'];
    }
  }
}

/**
 * 错误工厂类 - 统一创建各种错误
 */
export class DexErrorFactory {
  /**
   * 创建余额不足错误
   */
  static insufficientBalance(
    requiredAmount: string,
    currentBalance: string,
    tokenSymbol: string
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.INSUFFICIENT_BALANCE,
      `余额不足：需要 ${requiredAmount} ${tokenSymbol}，当前余额 ${currentBalance} ${tokenSymbol}`,
      { requiredAmount, currentBalance, tokenSymbol }
    );
  }

  /**
   * 创建授权不足错误
   */
  static insufficientAllowance(
    requiredAmount: string,
    currentAllowance: string,
    tokenSymbol: string,
    spenderAddress: string
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.INSUFFICIENT_ALLOWANCE,
      `授权不足：需要授权 ${requiredAmount} ${tokenSymbol}`,
      { requiredAmount, currentAllowance, tokenSymbol, spenderAddress },
      ['点击授权按钮完成代币授权'],
      true // 可恢复错误
    );
  }

  /**
   * 创建滑点过大错误
   */
  static slippageExceeded(
    expectedAmount: string,
    actualAmount: string,
    slippagePercent: string
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.SLIPPAGE_EXCEEDED,
      `滑点过大：预期 ${expectedAmount}，实际 ${actualAmount}`,
      { expectedAmount, actualAmount, slippagePercent },
      ['增加滑点容忍度', '减少交换数量'],
      true // 可恢复错误
    );
  }

  /**
   * 创建截止时间过期错误
   */
  static deadlineExceeded(deadline: number): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.DEADLINE_EXCEEDED,
      `交易截止时间已过期：${new Date(deadline * 1000).toISOString()}`,
      { deadline },
      ['重新获取报价', '使用更快的Gas价格'],
      true // 可恢复错误
    );
  }

  /**
   * 创建流动性不足错误
   */
  static liquidityInsufficient(
    fromTokenSymbol: string,
    toTokenSymbol: string,
    requestedAmount: string
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.LIQUIDITY_INSUFFICIENT,
      `流动性不足：${fromTokenSymbol} -> ${toTokenSymbol}，请求数量 ${requestedAmount}`,
      { fromTokenSymbol, toTokenSymbol, requestedAmount },
      ['减少交换数量', '等待流动性改善']
    );
  }

  /**
   * 创建价格影响过大错误
   */
  static priceImpactTooHigh(priceImpact: string, maxPriceImpact: string): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.PRICE_IMPACT_TOO_HIGH,
      `价格影响过大：${priceImpact}%，最大允许 ${maxPriceImpact}%`,
      { priceImpact, maxPriceImpact },
      ['减少交换数量', '分批次交换']
    );
  }

  /**
   * 创建网络错误
   */
  static networkError(originalError: Error, networkName?: string): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.NETWORK_ERROR,
      `网络错误${networkName ? ` (${networkName})` : ''}: ${originalError.message}`,
      { originalError, networkName },
      ['检查网络连接', '刷新页面重试'],
      true // 可恢复错误
    );
  }

  /**
   * 创建API错误
   */
  static apiError(
    apiName: string,
    statusCode?: number,
    responseData?: any
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.API_ERROR,
      `API错误 (${apiName})${statusCode ? ` HTTP ${statusCode}` : ''}`,
      { apiName, statusCode, responseData },
      ['稍后重试', '检查API服务状态'],
      true // 可恢复错误
    );
  }

  /**
   * 创建Gas估算失败错误
   */
  static gasEstimationFailed(originalError: Error): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.GAS_ESTIMATION_FAILED,
      `Gas估算失败: ${originalError.message}`,
      { originalError },
      ['使用默认Gas设置', '检查交易参数'],
      true // 可恢复错误
    );
  }

  /**
   * 创建交易失败错误
   */
  static transactionFailed(
    transactionHash?: string,
    revertReason?: string,
    gasUsed?: string
  ): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.TRANSACTION_FAILED,
      `交易执行失败${revertReason ? `: ${revertReason}` : ''}`,
      { transactionHash, revertReason, gasUsed },
      ['检查交易参数', '增加Gas限制', '稍后重试']
    );
  }

  /**
   * 创建参数无效错误
   */
  static invalidParameters(parameterName: string, value: any, requirement: string): DexSwapError {
    return new DexSwapError(
      SwapErrorCode.INVALID_PARAMETERS,
      `参数无效：${parameterName} = ${value}，要求：${requirement}`,
      { parameterName, value, requirement },
      ['检查输入参数', '查看API文档']
    );
  }

  /**
   * 从原始错误创建DEX错误
   */
  static fromError(error: Error, context?: any): DexSwapError {
    // 如果已经是DexSwapError，直接返回
    if (error instanceof DexSwapError) {
      return error;
    }

    // 根据错误消息推断错误类型
    const message = error.message.toLowerCase();
    
    if (message.includes('insufficient funds') || message.includes('balance')) {
      return DexErrorFactory.insufficientBalance('unknown', 'unknown', 'unknown');
    }
    
    if (message.includes('allowance') || message.includes('approval')) {
      return DexErrorFactory.insufficientAllowance('unknown', 'unknown', 'unknown', 'unknown');
    }
    
    if (message.includes('slippage') || message.includes('tolerance')) {
      return DexErrorFactory.slippageExceeded('unknown', 'unknown', 'unknown');
    }
    
    if (message.includes('deadline') || message.includes('expired')) {
      return DexErrorFactory.deadlineExceeded(Date.now() / 1000);
    }
    
    if (message.includes('liquidity')) {
      return DexErrorFactory.liquidityInsufficient('unknown', 'unknown', 'unknown');
    }
    
    if (message.includes('network') || message.includes('connection')) {
      return DexErrorFactory.networkError(error);
    }
    
    if (message.includes('gas')) {
      return DexErrorFactory.gasEstimationFailed(error);
    }
    
    // 默认为未知错误
    return new DexSwapError(
      SwapErrorCode.UNKNOWN_ERROR,
      error.message,
      { originalError: error, context },
      ['稍后重试', '如问题持续请联系支持']
    );
  }
}

/**
 * 错误统计器
 */
export class DexErrorTracker {
  private errorCounts = new Map<SwapErrorCode, number>();
  private recentErrors: DexSwapError[] = [];
  private readonly maxRecentErrors = 100;

  /**
   * 记录错误
   */
  public trackError(error: DexSwapError): void {
    // 更新错误计数
    const currentCount = this.errorCounts.get(error.code) || 0;
    this.errorCounts.set(error.code, currentCount + 1);

    // 添加到最近错误列表
    this.recentErrors.push(error);
    
    // 保持最近错误列表的大小
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
    }
  }

  /**
   * 获取错误统计
   */
  public getErrorStats(): Record<SwapErrorCode, number> {
    const stats: Record<SwapErrorCode, number> = {} as any;
    this.errorCounts.forEach((count, code) => {
      stats[code] = count;
    });
    return stats;
  }

  /**
   * 获取最近的错误
   */
  public getRecentErrors(limit: number = 10): DexSwapError[] {
    return this.recentErrors.slice(-limit);
  }

  /**
   * 清理统计
   */
  public clearStats(): void {
    this.errorCounts.clear();
    this.recentErrors = [];
  }

  /**
   * 获取最常见的错误
   */
  public getMostCommonErrors(limit: number = 5): Array<{ code: SwapErrorCode; count: number }> {
    const entries = Array.from(this.errorCounts.entries());
    return entries
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([code, count]) => ({ code, count }));
  }
}

// 导出全局错误追踪器
export const dexErrorTracker = new DexErrorTracker();