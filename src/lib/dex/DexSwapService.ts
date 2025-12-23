/**
 * 重构后的DEX交换服务主类
 * 整合了所有模块化组件，提供简洁易用的API
 */

import { ethers } from 'ethers';
import { okxClient } from '../okxClient';

// 导入所有模块化组件
import {
  DexSwapServiceOptions,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapExecuteRequest,
  SwapExecuteResponse,
  SwapEvent,
  SwapEventType,
  SwapEventCallback,
  SwapProgressCallback,
  TransactionData,
  SwapMetrics,
  DexConfig,
  NetworkConfig
} from './types';

import { configManager, createSwapConfig } from './config';
import { DexSwapError, DexErrorFactory, dexErrorTracker } from './errors';
import { dexEventEmitter, DexEventListenerFactory } from './events';
import { DexTransactionValidator, ValidationUtils } from './validator';
import { QuoteCacheManager } from './cache';
import { dexRetryManager } from './retry';

/**
 * 重构后的DEX交换服务类
 */
export class DexSwapService {
  private readonly validator: DexTransactionValidator;
  private readonly cacheManager: QuoteCacheManager;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet?: ethers.Wallet;
  private readonly config: DexConfig;
  private readonly networkConfig: NetworkConfig;
  private readonly options: Required<DexSwapServiceOptions>;
  private metrics: SwapMetrics;

  constructor(options: DexSwapServiceOptions) {
    this.options = {
      enableMetrics: true,
      enableEvents: true,
      simulationEnabled: true,
      maxPriceImpact: '10.0',
      defaultSlippage: '5.0',
      cacheConfig: {},
      retryConfig: {},
      ...options
    };

    this.networkConfig = options.network;
    this.config = options.dexConfig;
    
    // 初始化provider
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    
    // 初始化wallet（如果提供了私钥）
    const privateKey = process.env.XLAYER_PRIVATE_KEY;
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }

    // 初始化各个组件
    this.validator = new DexTransactionValidator(this.provider, this.networkConfig);
    this.cacheManager = new QuoteCacheManager(this.options.cacheConfig);
    
    // 初始化指标
    this.metrics = {
      totalSwaps: 0,
      successfulSwaps: 0,
      failedSwaps: 0,
      totalVolume: '0',
      averageGasUsed: '0',
      averageExecutionTime: 0,
      errorBreakdown: {} as any
    };

    // 设置事件监听器
    if (this.options.enableEvents) {
      this.setupEventListeners();
    }
  }

  /**
   * 获取交换报价
   */
  public async getQuote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    const startTime = Date.now();
    
    try {
      // 发射事件
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.QUOTE_REQUESTED, { request });
      }

      // 验证请求
      const validation = this.validator.validateQuoteRequest(request);
      if (!validation.isValid) {
        throw DexErrorFactory.invalidParameters('request', request, validation.errors.join(', '));
      }

      // 检查缓存
      const cacheKey = this.cacheManager.generateQuoteKey(
        request.fromTokenAddress,
        request.toTokenAddress,
        request.amount,
        request.slippagePercent || this.options.defaultSlippage
      );

      let cachedQuote = this.cacheManager.get(cacheKey);
      if (cachedQuote) {
        console.log('🔄 使用缓存报价');
        if (this.options.enableEvents) {
          dexEventEmitter.emit(SwapEventType.QUOTE_RECEIVED, { quote: cachedQuote, cached: true });
        }
        return cachedQuote;
      }

      // 获取新报价
      const quote = await dexRetryManager.networkRetry.executeWithRetry(async () => {
        return await this.fetchQuoteFromAPI(request);
      });

      if (!quote.success) {
        throw quote.error!;
      }

      const quoteResponse = quote.result!;
      
      // 缓存报价
      this.cacheManager.set(cacheKey, quoteResponse);

      // 发射事件
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.QUOTE_RECEIVED, { 
          quote: quoteResponse, 
          cached: false,
          duration: Date.now() - startTime
        });
      }

      return quoteResponse;

    } catch (error) {
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.QUOTE_FAILED, { error, request });
      }
      
      const dexError = error instanceof DexSwapError ? error : DexErrorFactory.fromError(error as Error);
      dexErrorTracker.trackError(dexError);
      throw dexError;
    }
  }

  /**
   * 执行代币交换
   */
  public async executeSwap(
    request: SwapExecuteRequest,
    progressCallback?: SwapProgressCallback
  ): Promise<SwapExecuteResponse> {
    const startTime = Date.now();
    
    try {
      if (!this.wallet) {
        throw DexErrorFactory.invalidParameters('wallet', 'undefined', 'wallet instance required for swap execution');
      }

      // 更新指标
      if (this.options.enableMetrics) {
        this.metrics.totalSwaps++;
      }

      // 设置进度跟踪
      let currentProgress = 0;
      const updateProgress = (progress: number, message: string) => {
        currentProgress = progress;
        progressCallback?.(progress, message);
      };

      // 发射事件
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.SWAP_INITIATED, { request });
      }

      updateProgress(10, '验证交换参数...');

      // 验证请求
      const fromToken = configManager.getToken(this.networkConfig.chainId, 'USDC');
      const toToken = configManager.getToken(this.networkConfig.chainId, 'WOKB');
      
      if (!fromToken || !toToken) {
        throw DexErrorFactory.invalidParameters('tokens', 'not found', 'token configuration not found');
      }

      const validation = await this.validator.validateCompleteSwapRequest(request, fromToken, toToken);
      if (!validation.isValid) {
        throw DexErrorFactory.invalidParameters('request', request, validation.errors.join(', '));
      }

      updateProgress(20, '获取最新报价...');

      // 获取最新报价
      const quote = await this.getQuote({
        fromTokenAddress: request.fromTokenAddress,
        toTokenAddress: request.toTokenAddress,
        amount: request.amount,
        walletAddress: request.walletAddress,
        slippagePercent: request.slippagePercent
      });

      updateProgress(30, '检查代币授权...');

      // 检查并处理代币授权
      await this.handleTokenApproval(request, updateProgress);

      updateProgress(50, '准备交易数据...');

      // 获取交易数据
      const txData = await this.prepareTransactionData(request, quote);

      updateProgress(60, '模拟交易执行...');

      // 模拟交易（如果启用）
      if (this.options.simulationEnabled) {
        await this.simulateTransaction(txData);
      }

      updateProgress(70, '提交区块链交易...');

      // 执行交易
      const txHash = await this.executeTransaction(txData);

      updateProgress(90, '等待交易确认...');

      // 等待交易确认
      const receipt = await this.waitForTransactionConfirmation(txHash);

      updateProgress(100, '交换完成');

      // 构建响应
      const response: SwapExecuteResponse = {
        success: true,
        transactionHash: txHash,
        explorerUrl: `${this.networkConfig.explorerUrl}/tx/${txHash}`,
        fromAmount: request.amount,
        toAmount: quote.toToken.amount,
        actualRate: quote.exchangeRate,
        gasUsed: receipt.gasUsed?.toString(),
        gasFee: receipt.fee?.toString()
      };

      // 更新指标
      if (this.options.enableMetrics) {
        this.metrics.successfulSwaps++;
        this.updateVolumeMetrics(request.amount);
        this.updateGasMetrics(receipt.gasUsed?.toString() || '0');
        this.updateExecutionTimeMetrics(Date.now() - startTime);
      }

      // 发射事件
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.SWAP_COMPLETED, { 
          response, 
          duration: Date.now() - startTime 
        }, txHash);
      }

      return response;

    } catch (error) {
      // 更新失败指标
      if (this.options.enableMetrics) {
        this.metrics.failedSwaps++;
      }

      const dexError = error instanceof DexSwapError ? error : DexErrorFactory.fromError(error as Error);
      
      // 更新错误统计
      if (this.options.enableMetrics) {
        this.updateErrorMetrics(dexError);
      }
      
      dexErrorTracker.trackError(dexError);

      // 发射事件
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.SWAP_FAILED, { 
          error: dexError, 
          request,
          duration: Date.now() - startTime
        });
      }

      const response: SwapExecuteResponse = {
        success: false,
        fromAmount: request.amount,
        toAmount: '0',
        errorMessage: dexError.toUserFriendly(),
        errorCode: dexError.code
      };

      return response;
    }
  }

  /**
   * 获取服务指标
   */
  public getMetrics(): SwapMetrics {
    return { ...this.metrics };
  }

  /**
   * 添加事件监听器
   */
  public on(eventType: SwapEventType, callback: SwapEventCallback): () => void {
    return dexEventEmitter.on(eventType, callback);
  }

  /**
   * 添加全局事件监听器
   */
  public onAll(callback: SwapEventCallback): () => void {
    return dexEventEmitter.onAll(callback);
  }

  /**
   * 清空缓存
   */
  public clearCache(): void {
    this.cacheManager.clear();
  }

  /**
   * 获取缓存统计
   */
  public getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * 销毁服务实例
   */
  public destroy(): void {
    this.cacheManager.destroy();
    dexEventEmitter.removeAllListeners();
  }

  // 私有方法

  /**
   * 从API获取报价
   */
  private async fetchQuoteFromAPI(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    console.log('🔍 获取API报价...');
    
    const quote = await okxClient.dex.getQuote({
      chainIndex: this.config.chainIndex,
      fromTokenAddress: request.fromTokenAddress,
      toTokenAddress: request.toTokenAddress,
      amount: parseInt(request.amount),
      slippagePercent: request.slippagePercent || this.options.defaultSlippage,
      userWalletAddress: request.walletAddress
    });

    if (!quote.data || quote.data.length === 0) {
      throw DexErrorFactory.apiError('OKX DEX', undefined, 'Empty quote response');
    }

    const quoteData = quote.data[0];
    const routerResult = quoteData.routerResult || quoteData;

    // 解析报价数据
    const fromToken = {
      address: request.fromTokenAddress,
      symbol: routerResult.fromToken?.tokenSymbol || 'UNKNOWN',
      name: routerResult.fromToken?.tokenName || 'Unknown Token',
      decimals: parseInt(routerResult.fromToken?.decimal || '18'),
      amount: request.amount,
      usdValue: parseFloat(routerResult.fromToken?.tokenUnitPrice || '0') * 
                parseFloat(request.amount) / Math.pow(10, parseInt(routerResult.fromToken?.decimal || '18'))
    };

    const toTokenAmount = routerResult.toTokenAmount;
    const toTokenDecimals = parseInt(routerResult.toToken?.decimal || '18');
    const expectedOutput = toTokenAmount ? 
      parseInt(toTokenAmount) / Math.pow(10, toTokenDecimals) : 0;

    const toToken = {
      address: request.toTokenAddress,
      symbol: routerResult.toToken?.tokenSymbol || 'UNKNOWN',
      name: routerResult.toToken?.tokenName || 'Unknown Token',
      decimals: toTokenDecimals,
      amount: expectedOutput.toString(),
      usdValue: expectedOutput * parseFloat(routerResult.toToken?.tokenUnitPrice || '0')
    };

    const response: SwapQuoteResponse = {
      fromToken,
      toToken,
      exchangeRate: (expectedOutput * Math.pow(10, 18) / parseInt(request.amount)).toFixed(6),
      priceImpact: '0', // 需要计算
      estimatedGas: routerResult.estimatedGas || '300000',
      route: [fromToken.symbol, toToken.symbol],
      validUntil: Date.now() + 30000 // 30秒有效期
    };

    return response;
  }

  /**
   * 处理代币授权
   */
  private async handleTokenApproval(
    request: SwapExecuteRequest,
    updateProgress: (progress: number, message: string) => void
  ): Promise<void> {
    // 如果是原生代币，无需授权
    if (request.fromTokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
      return;
    }

    // 这里需要知道spender地址，通常从swap API响应中获取
    // 简化实现，假设已知spender地址
    const spenderAddress = '0xC259de94F6bedDec5Ed1C024b0283082ffa50cca'; // 示例地址

    // 检查当前授权
    const validation = await this.validator.validateAllowance(
      request.fromTokenAddress,
      request.walletAddress,
      spenderAddress,
      request.amount,
      18 // 假设18位精度
    );

    if (!validation.isValid) {
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.APPROVAL_REQUIRED, { 
          tokenAddress: request.fromTokenAddress,
          spenderAddress,
          requiredAmount: request.amount
        });
      }

      updateProgress(35, '执行代币授权...');
      
      // 执行授权
      await this.executeApproval(request.fromTokenAddress, spenderAddress, request.amount);
      
      if (this.options.enableEvents) {
        dexEventEmitter.emit(SwapEventType.APPROVAL_COMPLETED, {
          tokenAddress: request.fromTokenAddress,
          spenderAddress
        });
      }
    }
  }

  /**
   * 执行代币授权
   */
  private async executeApproval(
    tokenAddress: string,
    spenderAddress: string,
    amount: string
  ): Promise<void> {
    if (!this.wallet) {
      throw DexErrorFactory.invalidParameters('wallet', 'undefined', 'wallet required for approval');
    }

    const erc20Abi = [
      'function approve(address spender, uint256 amount) external returns (bool)'
    ];

    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, this.wallet);
    const approveAmount = ethers.parseUnits(amount, 18); // 假设18位精度

    const tx = await tokenContract.approve(spenderAddress, approveAmount);
    await tx.wait();
  }

  /**
   * 准备交易数据
   */
  private async prepareTransactionData(
    request: SwapExecuteRequest,
    quote: SwapQuoteResponse
  ): Promise<TransactionData> {
    const swapData = await okxClient.dex.getSwapTx({
      chainIndex: this.config.chainIndex,
      fromTokenAddress: request.fromTokenAddress,
      toTokenAddress: request.toTokenAddress,
      amount: parseInt(request.amount),
      slippagePercent: request.slippagePercent || this.options.defaultSlippage,
      userWalletAddress: request.walletAddress
    });

    const swapResult = swapData.data?.[0] || swapData;
    let txData: TransactionData;

    // 提取交易数据
    if (swapResult.tx) {
      txData = swapResult.tx;
    } else {
      txData = {
        to: swapResult.to,
        data: swapResult.data,
        value: swapResult.value || '0',
        gas: swapResult.gas || '300000',
        gasPrice: swapResult.gasPrice || '100000000'
      };
    }

    // 验证交易数据
    const validation = this.validator.validateTransactionData(txData);
    if (!validation.isValid) {
      throw DexErrorFactory.invalidParameters('txData', txData, validation.errors.join(', '));
    }

    return txData;
  }

  /**
   * 模拟交易
   */
  private async simulateTransaction(txData: TransactionData): Promise<void> {
    if (this.options.enableEvents) {
      dexEventEmitter.emit(SwapEventType.SIMULATION_STARTED, { txData });
    }

    // 简单的模拟验证
    if (!txData.to || !txData.data || txData.data === '0x') {
      throw DexErrorFactory.transactionFailed(undefined, 'Invalid transaction data');
    }

    if (this.options.enableEvents) {
      dexEventEmitter.emit(SwapEventType.SIMULATION_COMPLETED, { success: true });
    }
  }

  /**
   * 执行区块链交易
   */
  private async executeTransaction(txData: TransactionData): Promise<string> {
    if (!this.wallet) {
      throw DexErrorFactory.invalidParameters('wallet', 'undefined', 'wallet required for transaction');
    }

    const transaction = {
      to: txData.to,
      data: txData.data,
      value: txData.value || '0',
      gasLimit: txData.gas,
      gasPrice: txData.gasPrice
    };

    const txResponse = await this.wallet.sendTransaction(transaction);
    
    if (this.options.enableEvents) {
      dexEventEmitter.emit(SwapEventType.TRANSACTION_SUBMITTED, { 
        hash: txResponse.hash 
      }, txResponse.hash);
    }

    return txResponse.hash;
  }

  /**
   * 等待交易确认
   */
  private async waitForTransactionConfirmation(txHash: string): Promise<ethers.TransactionReceipt> {
    const receipt = await this.provider.waitForTransaction(txHash);
    
    if (!receipt) {
      throw DexErrorFactory.transactionFailed(txHash, 'Transaction not found');
    }

    if (receipt.status === 0) {
      throw DexErrorFactory.transactionFailed(txHash, 'Transaction reverted');
    }

    if (this.options.enableEvents) {
      dexEventEmitter.emit(SwapEventType.TRANSACTION_CONFIRMED, { 
        hash: txHash,
        receipt 
      }, txHash, receipt.blockNumber);
    }

    return receipt;
  }

  /**
   * 设置默认事件监听器
   */
  private setupEventListeners(): void {
    // 进度跟踪监听器
    const progressListener = DexEventListenerFactory.createProgressTracker(
      (progress, message) => {
        console.log(`📊 进度: ${progress}% - ${message}`);
      }
    );

    // 错误处理监听器
    const errorListener = DexEventListenerFactory.createErrorHandler(
      (error, event) => {
        console.error(`🚨 错误事件 [${event.type}]:`, error.message);
      }
    );

    dexEventEmitter.onAll(progressListener);
    dexEventEmitter.onAll(errorListener);
  }

  /**
   * 更新指标 - 交易量
   */
  private updateVolumeMetrics(amount: string): void {
    const currentVolume = BigInt(this.metrics.totalVolume);
    const newAmount = BigInt(amount);
    this.metrics.totalVolume = (currentVolume + newAmount).toString();
  }

  /**
   * 更新指标 - Gas使用量
   */
  private updateGasMetrics(gasUsed: string): void {
    const currentGas = BigInt(this.metrics.averageGasUsed);
    const newGas = BigInt(gasUsed);
    const totalSwaps = BigInt(this.metrics.successfulSwaps);
    
    if (totalSwaps > 0n) {
      this.metrics.averageGasUsed = ((currentGas * (totalSwaps - 1n) + newGas) / totalSwaps).toString();
    } else {
      this.metrics.averageGasUsed = gasUsed;
    }
  }

  /**
   * 更新指标 - 执行时间
   */
  private updateExecutionTimeMetrics(duration: number): void {
    const totalSuccessful = this.metrics.successfulSwaps;
    
    if (totalSuccessful > 1) {
      this.metrics.averageExecutionTime = 
        (this.metrics.averageExecutionTime * (totalSuccessful - 1) + duration) / totalSuccessful;
    } else {
      this.metrics.averageExecutionTime = duration;
    }
  }

  /**
   * 更新指标 - 错误统计
   */
  private updateErrorMetrics(error: DexSwapError): void {
    const current = this.metrics.errorBreakdown[error.code] || 0;
    this.metrics.errorBreakdown[error.code] = current + 1;
  }
}

/**
 * 工厂函数：创建X Layer USDC->WOKB交换服务
 */
export function createXLayerUsdcWokbSwapService(): DexSwapService {
  const networkConfig = configManager.getNetwork('xlayer');
  const dexConfig = createSwapConfig('xlayer', 'USDC', 'WOKB', '10.0');
  
  if (!networkConfig || !dexConfig) {
    throw new Error('Failed to create X Layer USDC->WOKB swap service configuration');
  }

  return new DexSwapService({
    network: networkConfig,
    dexConfig: dexConfig,
    enableMetrics: true,
    enableEvents: true,
    simulationEnabled: true,
    maxPriceImpact: '10.0',
    defaultSlippage: '10.0'
  });
}

/**
 * 工厂函数：从配置创建交换服务
 */
export function createDexSwapService(options: DexSwapServiceOptions): DexSwapService {
  return new DexSwapService(options);
}

// 导出默认实例
export const defaultDexSwapService = createXLayerUsdcWokbSwapService();