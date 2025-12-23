/**
 * DEX交换服务的完整类型定义
 */

// 基础类型
export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

export interface NetworkConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeToken: TokenInfo;
  wrappedToken?: TokenInfo;
}

export interface DexConfig {
  chainIndex: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  slippagePercent: string;
  routerAddress?: string;
  factoryAddress?: string;
}

// 交换相关类型
export interface SwapQuoteRequest {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  walletAddress: string;
  slippagePercent?: string;
}

export interface SwapQuoteResponse {
  fromToken: TokenInfo & { amount: string; usdValue: number };
  toToken: TokenInfo & { amount: string; usdValue: number };
  exchangeRate: string;
  priceImpact: string;
  estimatedGas: string;
  route: string[];
  validUntil: number;
}

export interface SwapExecuteRequest extends SwapQuoteRequest {
  maxSlippagePercent?: string;
  deadline?: number;
  gasPrice?: string;
  gasLimit?: string;
}

export interface SwapExecuteResponse {
  success: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  fromAmount: string;
  toAmount: string;
  actualRate?: string;
  gasUsed?: string;
  gasFee?: string;
  errorMessage?: string;
  errorCode?: SwapErrorCode;
}

// 交易相关类型
export interface TransactionData {
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
  nonce?: number;
}

export interface SimulationResult {
  success: boolean;
  gasUsed: string;
  gasLimit: string;
  revertReason?: string;
  estimatedOutput?: string;
}

// 错误类型
export enum SwapErrorCode {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_ALLOWANCE = 'INSUFFICIENT_ALLOWANCE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  LIQUIDITY_INSUFFICIENT = 'LIQUIDITY_INSUFFICIENT',
  PRICE_IMPACT_TOO_HIGH = 'PRICE_IMPACT_TOO_HIGH',
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface DexError extends Error {
  code: SwapErrorCode;
  details?: any;
  suggestions?: string[];
}

// 事件类型
export enum SwapEventType {
  QUOTE_REQUESTED = 'quote_requested',
  QUOTE_RECEIVED = 'quote_received',
  QUOTE_FAILED = 'quote_failed',
  SWAP_INITIATED = 'swap_initiated',
  APPROVAL_REQUIRED = 'approval_required',
  APPROVAL_COMPLETED = 'approval_completed',
  SIMULATION_STARTED = 'simulation_started',
  SIMULATION_COMPLETED = 'simulation_completed',
  TRANSACTION_SUBMITTED = 'transaction_submitted',
  TRANSACTION_CONFIRMED = 'transaction_confirmed',
  TRANSACTION_FAILED = 'transaction_failed',
  SWAP_COMPLETED = 'swap_completed',
  SWAP_FAILED = 'swap_failed'
}

export interface SwapEvent {
  type: SwapEventType;
  timestamp: number;
  data: any;
  transactionHash?: string;
  blockNumber?: number;
}

// 缓存类型
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
}

export interface CacheConfig {
  quoteTtl: number;
  maxSize: number;
  cleanupInterval: number;
}

// 重试配置
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: SwapErrorCode[];
}

// 监控和统计
export interface SwapMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  totalVolume: string;
  averageGasUsed: string;
  averageExecutionTime: number;
  errorBreakdown: Record<SwapErrorCode, number>;
}

// 配置选项
export interface DexSwapServiceOptions {
  network: NetworkConfig;
  dexConfig: DexConfig;
  cacheConfig?: Partial<CacheConfig>;
  retryConfig?: Partial<RetryConfig>;
  enableMetrics?: boolean;
  enableEvents?: boolean;
  simulationEnabled?: boolean;
  maxPriceImpact?: string;
  defaultSlippage?: string;
}

// 回调类型
export type SwapEventCallback = (event: SwapEvent) => void;
export type SwapProgressCallback = (progress: number, message: string) => void;

// 高级交换选项
export interface AdvancedSwapOptions {
  recipient?: string;
  referralAddress?: string;
  customRoute?: string[];
  partialSwapEnabled?: boolean;
  mevProtection?: boolean;
  flashloanEnabled?: boolean;
}