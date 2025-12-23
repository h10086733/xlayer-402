/**
 * DEX交换服务的配置管理器
 */

import { NetworkConfig, DexConfig, TokenInfo, CacheConfig, RetryConfig } from './types';

// 预定义的网络配置
export const NETWORKS: Record<string, NetworkConfig> = {
  xlayer: {
    chainId: '196',
    name: 'X Layer',
    rpcUrl: process.env.X_LAYER_RPC_URL || 'https://rpc.xlayer.tech',
    explorerUrl: 'https://www.oklink.com/xlayer',
    nativeToken: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    }
  },
  base: {
    chainId: '8453',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeToken: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    }
  },
  ethereum: {
    chainId: '1',
    name: 'Ethereum',
    rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY',
    explorerUrl: 'https://etherscan.io',
    nativeToken: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    }
  },
  bsc: {
    chainId: '56',
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeToken: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'BNB',
      name: 'BNB',
      decimals: 18
    }
  }
};

// 预定义的代币配置
export const TOKENS: Record<string, Record<string, TokenInfo>> = {
  xlayer: {
    ETH: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    USDC: {
      address: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    },
    WOKB: {
      address: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
      symbol: 'WOKB',
      name: 'Wrapped OKB',
      decimals: 18
    }
  },
  base: {
    ETH: {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    USDC: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    }
  }
};

// 预定义的DEX配置
export const DEX_CONFIGS: Record<string, DexConfig> = {
  xlayer_usdc_wokb: {
    chainIndex: '196',
    fromTokenAddress: '0x74b7f16337b8972027f6196a17a631ac6de26d22', // USDC
    toTokenAddress: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',   // WOKB
    slippagePercent: '10.0'
  },
  base_eth_usdc: {
    chainIndex: '8453',
    fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
    toTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // USDC
    slippagePercent: '5.0'
  }
};

// 默认配置
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  quoteTtl: 30000, // 30秒
  maxSize: 100,
  cleanupInterval: 60000 // 1分钟
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  retryableErrors: [
    'NETWORK_ERROR',
    'API_ERROR',
    'GAS_ESTIMATION_FAILED'
  ] as any
};

/**
 * 配置管理器类
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private networks = new Map<string, NetworkConfig>();
  private tokens = new Map<string, Map<string, TokenInfo>>();
  private dexConfigs = new Map<string, DexConfig>();

  private constructor() {
    this.initializeDefaults();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private initializeDefaults(): void {
    // 加载默认网络
    Object.entries(NETWORKS).forEach(([key, config]) => {
      this.networks.set(key, config);
    });

    // 加载默认代币
    Object.entries(TOKENS).forEach(([networkKey, networkTokens]) => {
      const tokenMap = new Map<string, TokenInfo>();
      Object.entries(networkTokens).forEach(([symbol, token]) => {
        tokenMap.set(symbol, token);
      });
      this.tokens.set(networkKey, tokenMap);
    });

    // 加载默认DEX配置
    Object.entries(DEX_CONFIGS).forEach(([key, config]) => {
      this.dexConfigs.set(key, config);
    });
  }

  // 网络管理
  public getNetwork(networkKey: string): NetworkConfig | undefined {
    return this.networks.get(networkKey);
  }

  public addNetwork(key: string, config: NetworkConfig): void {
    this.networks.set(key, config);
  }

  public getAllNetworks(): Map<string, NetworkConfig> {
    return new Map(this.networks);
  }

  // 代币管理
  public getToken(networkKey: string, symbol: string): TokenInfo | undefined {
    const networkTokens = this.tokens.get(networkKey);
    return networkTokens?.get(symbol);
  }

  public addToken(networkKey: string, symbol: string, token: TokenInfo): void {
    let networkTokens = this.tokens.get(networkKey);
    if (!networkTokens) {
      networkTokens = new Map();
      this.tokens.set(networkKey, networkTokens);
    }
    networkTokens.set(symbol, token);
  }

  public getNetworkTokens(networkKey: string): Map<string, TokenInfo> | undefined {
    return this.tokens.get(networkKey);
  }

  // DEX配置管理
  public getDexConfig(configKey: string): DexConfig | undefined {
    return this.dexConfigs.get(configKey);
  }

  public addDexConfig(key: string, config: DexConfig): void {
    this.dexConfigs.set(key, config);
  }

  public createDexConfig(
    networkKey: string,
    fromSymbol: string,
    toSymbol: string,
    slippagePercent: string = '5.0'
  ): DexConfig | undefined {
    const network = this.getNetwork(networkKey);
    const fromToken = this.getToken(networkKey, fromSymbol);
    const toToken = this.getToken(networkKey, toSymbol);

    if (!network || !fromToken || !toToken) {
      return undefined;
    }

    return {
      chainIndex: network.chainId,
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      slippagePercent
    };
  }

  // 验证配置
  public validateNetwork(config: NetworkConfig): string[] {
    const errors: string[] = [];
    
    if (!config.chainId) errors.push('chainId is required');
    if (!config.name) errors.push('name is required');
    if (!config.rpcUrl) errors.push('rpcUrl is required');
    if (!config.nativeToken) errors.push('nativeToken is required');
    
    return errors;
  }

  public validateToken(token: TokenInfo): string[] {
    const errors: string[] = [];
    
    if (!token.address) errors.push('address is required');
    if (!token.symbol) errors.push('symbol is required');
    if (!token.name) errors.push('name is required');
    if (token.decimals < 0 || token.decimals > 255) {
      errors.push('decimals must be between 0 and 255');
    }
    
    return errors;
  }

  public validateDexConfig(config: DexConfig): string[] {
    const errors: string[] = [];
    
    if (!config.chainIndex) errors.push('chainIndex is required');
    if (!config.fromTokenAddress) errors.push('fromTokenAddress is required');
    if (!config.toTokenAddress) errors.push('toTokenAddress is required');
    if (!config.slippagePercent) errors.push('slippagePercent is required');
    
    const slippage = parseFloat(config.slippagePercent);
    if (isNaN(slippage) || slippage < 0 || slippage > 100) {
      errors.push('slippagePercent must be a valid number between 0 and 100');
    }
    
    return errors;
  }

  // 环境变量集成
  public loadFromEnvironment(): void {
    // 从环境变量加载额外配置
    const networkKeys = process.env.SUPPORTED_NETWORKS?.split(',') || [];
    
    networkKeys.forEach(networkKey => {
      const rpcUrl = process.env[`${networkKey.toUpperCase()}_RPC_URL`];
      const explorerUrl = process.env[`${networkKey.toUpperCase()}_EXPLORER_URL`];
      
      if (rpcUrl) {
        const existingNetwork = this.getNetwork(networkKey);
        if (existingNetwork) {
          this.addNetwork(networkKey, {
            ...existingNetwork,
            rpcUrl,
            explorerUrl: explorerUrl || existingNetwork.explorerUrl
          });
        }
      }
    });
  }
}

// 导出单例实例
export const configManager = ConfigManager.getInstance();

// 便捷函数
export function getNetworkConfig(networkKey: string): NetworkConfig {
  const config = configManager.getNetwork(networkKey);
  if (!config) {
    throw new Error(`Network configuration not found: ${networkKey}`);
  }
  return config;
}

export function getTokenInfo(networkKey: string, symbol: string): TokenInfo {
  const token = configManager.getToken(networkKey, symbol);
  if (!token) {
    throw new Error(`Token not found: ${symbol} on ${networkKey}`);
  }
  return token;
}

export function createSwapConfig(
  networkKey: string,
  fromSymbol: string,
  toSymbol: string,
  slippagePercent?: string
): DexConfig {
  const config = configManager.createDexConfig(
    networkKey,
    fromSymbol,
    toSymbol,
    slippagePercent
  );
  if (!config) {
    throw new Error(`Cannot create swap config: ${fromSymbol} -> ${toSymbol} on ${networkKey}`);
  }
  return config;
}