/**
 * DEX交换服务的统一导出文件
 * 提供完整的模块化DEX交换解决方案
 */

// 主要服务类
export { 
  DexSwapService, 
  createXLayerUsdcWokbSwapService,
  createDexSwapService,
  defaultDexSwapService 
} from './DexSwapService';

// 类型定义
export * from './types';

// 配置管理
export { 
  configManager, 
  ConfigManager,
  getNetworkConfig,
  getTokenInfo,
  createSwapConfig,
  NETWORKS,
  TOKENS,
  DEX_CONFIGS,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_RETRY_CONFIG
} from './config';

// 错误处理
export { 
  DexSwapError, 
  DexErrorFactory, 
  dexErrorTracker,
  DexErrorTracker
} from './errors';

// 事件系统
export { 
  dexEventEmitter,
  DexEventEmitter,
  DexEventUtils,
  DexEventListenerFactory
} from './events';

// 验证器
export { 
  DexTransactionValidator, 
  ValidationUtils 
} from './validator';

// 缓存管理
export { 
  SmartCacheManager,
  QuoteCacheManager,
  TieredCacheManager,
  quoteCacheManager,
  CacheStrategy
} from './cache';

// 重试机制
export { 
  SmartRetryManager,
  CircuitBreaker,
  RetryUtils,
  dexRetryManager,
  DexRetryManager,
  RetryStrategy
} from './retry';

// 便捷工具函数
export { ValidationUtils as DexUtils } from './validator';

// 默认导出 - 使用重新导出避免循环引用
import { defaultDexSwapService } from './DexSwapService';
export default defaultDexSwapService;