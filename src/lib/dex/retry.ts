/**
 * DEX交换服务的智能重试机制
 */

import { RetryConfig, SwapErrorCode } from './types';
import { DexSwapError, DexErrorFactory } from './errors';

/**
 * 重试策略枚举
 */
export enum RetryStrategy {
  FIXED_DELAY = 'fixed_delay',
  EXPONENTIAL_BACKOFF = 'exponential_backoff',
  LINEAR_BACKOFF = 'linear_backoff',
  JITTERED_BACKOFF = 'jittered_backoff'
}

/**
 * 重试结果接口
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
  lastAttemptAt: number;
}

/**
 * 重试上下文
 */
interface RetryContext {
  attempt: number;
  startTime: number;
  lastError?: Error;
  delays: number[];
}

/**
 * 智能重试管理器
 */
export class SmartRetryManager {
  private config: Required<RetryConfig>;
  private strategy: RetryStrategy;
  private activeRetries = new Map<string, RetryContext>();

  constructor(
    config: Partial<RetryConfig> = {},
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL_BACKOFF
  ) {
    this.config = {
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      retryableErrors: [
        SwapErrorCode.NETWORK_ERROR,
        SwapErrorCode.API_ERROR,
        SwapErrorCode.GAS_ESTIMATION_FAILED
      ],
      ...config
    };
    this.strategy = strategy;
  }

  /**
   * 执行带重试的操作
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationId?: string,
    customConfig?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const effectiveConfig = { ...this.config, ...customConfig };
    const context: RetryContext = {
      attempt: 0,
      startTime: Date.now(),
      delays: []
    };

    if (operationId) {
      this.activeRetries.set(operationId, context);
    }

    try {
      const result = await this.executeAttempts(operation, context, effectiveConfig);
      return {
        success: true,
        result,
        attempts: context.attempt,
        totalDuration: Date.now() - context.startTime,
        lastAttemptAt: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
        attempts: context.attempt,
        totalDuration: Date.now() - context.startTime,
        lastAttemptAt: Date.now()
      };
    } finally {
      if (operationId) {
        this.activeRetries.delete(operationId);
      }
    }
  }

  /**
   * 执行多次尝试
   */
  private async executeAttempts<T>(
    operation: () => Promise<T>,
    context: RetryContext,
    config: Required<RetryConfig>
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      context.attempt = attempt;

      try {
        console.log(`🔄 执行操作，尝试 ${attempt}/${config.maxAttempts}`);
        const result = await operation();
        
        if (attempt > 1) {
          console.log(`✅ 操作成功，重试 ${attempt - 1} 次后成功`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        context.lastError = lastError;

        console.warn(`❌ 操作失败，尝试 ${attempt}/${config.maxAttempts}:`, lastError.message);

        // 检查是否为可重试的错误
        if (!this.isRetryableError(lastError, config.retryableErrors)) {
          console.log(`🚫 错误不可重试: ${lastError.message}`);
          throw lastError;
        }

        // 如果不是最后一次尝试，等待后重试
        if (attempt < config.maxAttempts) {
          const delay = this.calculateDelay(attempt, config);
          context.delays.push(delay);
          
          console.log(`⏳ 等待 ${delay}ms 后重试...`);
          await this.sleep(delay);
        }
      }
    }

    // 所有尝试都失败了
    console.error(`💥 所有重试尝试失败，总尝试次数: ${config.maxAttempts}`);
    throw lastError!;
  }

  /**
   * 检查错误是否可重试
   */
  private isRetryableError(error: Error, retryableErrors: SwapErrorCode[]): boolean {
    // 如果是DexSwapError，检查错误代码
    if (error instanceof DexSwapError) {
      return retryableErrors.includes(error.code);
    }

    // 对于其他类型的错误，根据消息内容判断
    const message = error.message.toLowerCase();
    
    // 网络相关错误
    if (message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection') ||
        message.includes('fetch')) {
      return retryableErrors.includes(SwapErrorCode.NETWORK_ERROR);
    }

    // API相关错误
    if (message.includes('api') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')) {
      return retryableErrors.includes(SwapErrorCode.API_ERROR);
    }

    // Gas估算错误
    if (message.includes('gas') ||
        message.includes('estimate')) {
      return retryableErrors.includes(SwapErrorCode.GAS_ESTIMATION_FAILED);
    }

    return false;
  }

  /**
   * 计算延迟时间
   */
  private calculateDelay(attempt: number, config: Required<RetryConfig>): number {
    let delay: number;

    switch (this.strategy) {
      case RetryStrategy.FIXED_DELAY:
        delay = config.backoffMs;
        break;

      case RetryStrategy.LINEAR_BACKOFF:
        delay = config.backoffMs * attempt;
        break;

      case RetryStrategy.EXPONENTIAL_BACKOFF:
        delay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
        break;

      case RetryStrategy.JITTERED_BACKOFF:
        const exponentialDelay = config.backoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
        delay = exponentialDelay + jitter;
        break;

      default:
        delay = config.backoffMs;
    }

    // 确保延迟不会过长（最大30秒）
    return Math.min(delay, 30000);
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取活跃的重试状态
   */
  public getActiveRetries(): Map<string, RetryContext> {
    return new Map(this.activeRetries);
  }

  /**
   * 取消特定的重试操作
   */
  public cancelRetry(operationId: string): boolean {
    return this.activeRetries.delete(operationId);
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 更新策略
   */
  public updateStrategy(strategy: RetryStrategy): void {
    this.strategy = strategy;
  }
}

/**
 * 断路器模式实现
 */
export class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeMs: number = 60000,
    private readonly successThreshold: number = 2
  ) {}

  /**
   * 执行操作，带断路器保护
   */
  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.recoveryTimeMs) {
        throw DexErrorFactory.apiError('Circuit Breaker', 503, 'Circuit is OPEN');
      } else {
        this.state = 'HALF_OPEN';
        console.log('🔄 断路器进入半开状态');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * 成功回调
   */
  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        console.log('✅ 断路器关闭，服务恢复正常');
      }
    }
  }

  /**
   * 失败回调
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`⚠️  断路器开启，失败次数达到阈值: ${this.failureCount}`);
    }
  }

  /**
   * 获取断路器状态
   */
  public getState(): { 
    state: string; 
    failureCount: number; 
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  /**
   * 手动重置断路器
   */
  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    console.log('🔄 断路器已手动重置');
  }
}

/**
 * 重试工具类
 */
export class RetryUtils {
  /**
   * 简单重试装饰器
   */
  static withRetry<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    config: Partial<RetryConfig> = {}
  ): (...args: T) => Promise<R> {
    const retryManager = new SmartRetryManager(config);
    
    return async (...args: T): Promise<R> => {
      const result = await retryManager.executeWithRetry(() => fn(...args));
      if (result.success) {
        return result.result!;
      } else {
        throw result.error!;
      }
    };
  }

  /**
   * 创建重试策略
   */
  static createRetryConfig(
    errorCodes: SwapErrorCode[],
    maxAttempts: number = 3,
    baseDelayMs: number = 1000
  ): RetryConfig {
    return {
      maxAttempts,
      backoffMs: baseDelayMs,
      backoffMultiplier: 2,
      retryableErrors: errorCodes
    };
  }

  /**
   * 批量操作重试
   */
  static async batchWithRetry<T, R>(
    items: T[],
    operation: (item: T) => Promise<R>,
    config: Partial<RetryConfig> = {},
    concurrency: number = 3
  ): Promise<Array<{ item: T; result?: R; error?: Error }>> {
    const retryManager = new SmartRetryManager(config);
    const results: Array<{ item: T; result?: R; error?: Error }> = [];

    // 分批处理
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (item) => {
        const retryResult = await retryManager.executeWithRetry(
          () => operation(item),
          `batch_${i}_${item}`
        );
        
        return {
          item,
          result: retryResult.success ? retryResult.result : undefined,
          error: retryResult.success ? undefined : retryResult.error
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
}

/**
 * 预配置的重试管理器
 */
export class DexRetryManager {
  private static instance: DexRetryManager;
  
  public readonly networkRetry: SmartRetryManager;
  public readonly apiRetry: SmartRetryManager;
  public readonly transactionRetry: SmartRetryManager;
  public readonly circuitBreaker: CircuitBreaker;

  private constructor() {
    // 网络错误重试配置
    this.networkRetry = new SmartRetryManager({
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      retryableErrors: [SwapErrorCode.NETWORK_ERROR]
    }, RetryStrategy.EXPONENTIAL_BACKOFF);

    // API错误重试配置
    this.apiRetry = new SmartRetryManager({
      maxAttempts: 5,
      backoffMs: 500,
      backoffMultiplier: 1.5,
      retryableErrors: [SwapErrorCode.API_ERROR]
    }, RetryStrategy.JITTERED_BACKOFF);

    // 交易错误重试配置
    this.transactionRetry = new SmartRetryManager({
      maxAttempts: 2,
      backoffMs: 2000,
      backoffMultiplier: 2,
      retryableErrors: [SwapErrorCode.GAS_ESTIMATION_FAILED]
    }, RetryStrategy.FIXED_DELAY);

    // 断路器配置
    this.circuitBreaker = new CircuitBreaker(5, 60000, 2);
  }

  public static getInstance(): DexRetryManager {
    if (!DexRetryManager.instance) {
      DexRetryManager.instance = new DexRetryManager();
    }
    return DexRetryManager.instance;
  }

  /**
   * 根据错误类型选择合适的重试管理器
   */
  public getRetryManagerForError(error: Error): SmartRetryManager {
    if (error instanceof DexSwapError) {
      switch (error.code) {
        case SwapErrorCode.NETWORK_ERROR:
          return this.networkRetry;
        case SwapErrorCode.API_ERROR:
          return this.apiRetry;
        case SwapErrorCode.GAS_ESTIMATION_FAILED:
          return this.transactionRetry;
        default:
          return this.apiRetry; // 默认使用API重试
      }
    }
    
    return this.networkRetry; // 默认使用网络重试
  }

  /**
   * 智能重试：根据错误类型自动选择策略
   */
  public async smartRetry<T>(
    operation: () => Promise<T>,
    operationId?: string
  ): Promise<RetryResult<T>> {
    try {
      // 先尝试一次，获取错误类型
      const result = await operation();
      return {
        success: true,
        result,
        attempts: 1,
        totalDuration: 0,
        lastAttemptAt: Date.now()
      };
    } catch (error) {
      // 根据错误类型选择重试策略
      const retryManager = this.getRetryManagerForError(error as Error);
      return await retryManager.executeWithRetry(operation, operationId);
    }
  }
}

// 导出单例实例
export const dexRetryManager = DexRetryManager.getInstance();