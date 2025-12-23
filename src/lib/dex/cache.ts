/**
 * DEX交换服务的智能缓存管理器
 */

import { CacheEntry, CacheConfig } from './types';

/**
 * 缓存策略枚举
 */
export enum CacheStrategy {
  LRU = 'lru',           // 最近最少使用
  LFU = 'lfu',           // 最少使用频率
  FIFO = 'fifo',         // 先进先出
  TTL_ONLY = 'ttl_only'  // 仅基于TTL
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
  evictions: number;
  averageAge: number;
}

/**
 * 扩展缓存条目，包含使用统计
 */
interface ExtendedCacheEntry<T> extends CacheEntry<T> {
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
}

/**
 * 智能缓存管理器
 */
export class SmartCacheManager<T = any> {
  private cache = new Map<string, ExtendedCacheEntry<T>>();
  private accessOrder: string[] = []; // for LRU
  private config: Required<CacheConfig>;
  private strategy: CacheStrategy;
  private stats: CacheStats;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    config: Partial<CacheConfig> = {},
    strategy: CacheStrategy = CacheStrategy.LRU
  ) {
    this.config = {
      quoteTtl: 30000,
      maxSize: 100,
      cleanupInterval: 60000,
      ...config
    };
    this.strategy = strategy;
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: this.config.maxSize,
      hitRate: 0,
      evictions: 0,
      averageAge: 0
    };

    this.startPeriodicCleanup();
  }

  /**
   * 存储数据到缓存
   */
  public set(
    key: string,
    data: T,
    ttl: number = this.config.quoteTtl,
    tags: string[] = []
  ): void {
    const now = Date.now();
    const entry: ExtendedCacheEntry<T> = {
      key,
      data,
      timestamp: now,
      ttl,
      accessCount: 1,
      lastAccessed: now,
      createdAt: now
    };

    // 如果缓存已满，根据策略移除条目
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictEntry();
    }

    // 更新访问顺序（LRU策略）
    if (this.strategy === CacheStrategy.LRU) {
      this.updateAccessOrder(key);
    }

    this.cache.set(key, entry);
    this.updateStats();
  }

  /**
   * 从缓存获取数据
   */
  public get(key: string): T | undefined {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return undefined;
    }

    // 检查是否过期
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.stats.misses++;
      this.updateHitRate();
      return undefined;
    }

    // 更新访问统计
    entry.accessCount++;
    entry.lastAccessed = now;

    // 更新访问顺序（LRU策略）
    if (this.strategy === CacheStrategy.LRU) {
      this.updateAccessOrder(key);
    }

    this.stats.hits++;
    this.updateHitRate();
    return entry.data;
  }

  /**
   * 检查缓存中是否存在有效数据
   */
  public has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存条目
   */
  public delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.removeFromAccessOrder(key);
      this.updateStats();
    }
    return deleted;
  }

  /**
   * 清空所有缓存
   */
  public clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.resetStats();
  }

  /**
   * 根据前缀删除缓存
   */
  public deleteByPrefix(prefix: string): number {
    let deletedCount = 0;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      if (this.delete(key)) {
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 根据标签删除缓存（需要扩展实现）
   */
  public deleteByTag(tag: string): number {
    // 这里需要扩展Entry结构来支持标签
    // 暂时返回0
    return 0;
  }

  /**
   * 获取缓存大小
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存键列表
   */
  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取所有缓存条目
   */
  public entries(): Array<{ key: string; data: T; timestamp: number; ttl: number }> {
    const entries: Array<{ key: string; data: T; timestamp: number; ttl: number }> = [];
    
    this.cache.forEach((entry, key) => {
      entries.push({
        key,
        data: entry.data,
        timestamp: entry.timestamp,
        ttl: entry.ttl
      });
    });

    return entries;
  }

  /**
   * 获取缓存统计信息
   */
  public getStats(): CacheStats {
    this.updateAverageAge();
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  public resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: 0,
      evictions: 0,
      averageAge: 0
    };
  }

  /**
   * 手动清理过期条目
   */
  public cleanup(): number {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        expiredKeys.push(key);
      }
    });

    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
    }

    this.updateStats();
    return expiredKeys.length;
  }

  /**
   * 获取缓存热点数据
   */
  public getHotEntries(limit: number = 10): Array<{ key: string; accessCount: number; data: T }> {
    const entries = Array.from(this.cache.entries());
    
    return entries
      .sort(([, a], [, b]) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(([key, entry]) => ({
        key,
        accessCount: entry.accessCount,
        data: entry.data
      }));
  }

  /**
   * 预热缓存
   */
  public async warmup(
    dataProvider: (key: string) => Promise<T>,
    keys: string[],
    ttl?: number
  ): Promise<void> {
    const warmupPromises = keys.map(async (key) => {
      try {
        const data = await dataProvider(key);
        this.set(key, data, ttl);
      } catch (error) {
        console.warn(`Failed to warmup cache for key: ${key}`, error);
      }
    });

    await Promise.allSettled(warmupPromises);
  }

  /**
   * 销毁缓存管理器
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }

  // 私有方法

  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    // 确保在程序退出时清理定时器
    process.on('exit', () => this.destroy());
    process.on('SIGINT', () => this.destroy());
    process.on('SIGTERM', () => this.destroy());
  }

  private evictEntry(): void {
    let keyToEvict: string | undefined;

    switch (this.strategy) {
      case CacheStrategy.LRU:
        keyToEvict = this.accessOrder[0];
        break;

      case CacheStrategy.LFU:
        keyToEvict = this.findLeastFrequentlyUsed();
        break;

      case CacheStrategy.FIFO:
        keyToEvict = this.findOldestEntry();
        break;

      case CacheStrategy.TTL_ONLY:
        keyToEvict = this.findSoonestToExpire();
        break;
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.removeFromAccessOrder(keyToEvict);
      this.stats.evictions++;
    }
  }

  private findLeastFrequentlyUsed(): string | undefined {
    let minAccessCount = Infinity;
    let keyToEvict: string | undefined;

    this.cache.forEach((entry, key) => {
      if (entry.accessCount < minAccessCount) {
        minAccessCount = entry.accessCount;
        keyToEvict = key;
      }
    });

    return keyToEvict;
  }

  private findOldestEntry(): string | undefined {
    let oldestTime = Infinity;
    let keyToEvict: string | undefined;

    this.cache.forEach((entry, key) => {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        keyToEvict = key;
      }
    });

    return keyToEvict;
  }

  private findSoonestToExpire(): string | undefined {
    let soonestExpiry = Infinity;
    let keyToEvict: string | undefined;
    const now = Date.now();

    this.cache.forEach((entry, key) => {
      const expiryTime = entry.timestamp + entry.ttl;
      if (expiryTime < soonestExpiry) {
        soonestExpiry = expiryTime;
        keyToEvict = key;
      }
    });

    return keyToEvict;
  }

  private updateAccessOrder(key: string): void {
    // 移除旧位置
    this.removeFromAccessOrder(key);
    // 添加到最后（最近使用）
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private updateStats(): void {
    this.stats.size = this.cache.size;
    this.updateHitRate();
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private updateAverageAge(): void {
    if (this.cache.size === 0) {
      this.stats.averageAge = 0;
      return;
    }

    const now = Date.now();
    let totalAge = 0;

    this.cache.forEach(entry => {
      totalAge += now - entry.createdAt;
    });

    this.stats.averageAge = totalAge / this.cache.size;
  }
}

/**
 * 专门的报价缓存管理器
 */
export class QuoteCacheManager extends SmartCacheManager {
  constructor(config: Partial<CacheConfig> = {}) {
    super(config, CacheStrategy.LRU);
  }

  /**
   * 生成报价缓存键
   */
  public generateQuoteKey(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    slippagePercent: string
  ): string {
    return `quote:${fromTokenAddress}:${toTokenAddress}:${amount}:${slippagePercent}`;
  }

  /**
   * 存储报价数据
   */
  public setQuote(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    slippagePercent: string,
    quoteData: any,
    ttl?: number
  ): void {
    const key = this.generateQuoteKey(fromTokenAddress, toTokenAddress, amount, slippagePercent);
    this.set(key, quoteData, ttl);
  }

  /**
   * 获取报价数据
   */
  public getQuote(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    slippagePercent: string
  ): any | undefined {
    const key = this.generateQuoteKey(fromTokenAddress, toTokenAddress, amount, slippagePercent);
    return this.get(key);
  }

  /**
   * 检查报价是否存在
   */
  public hasQuote(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    slippagePercent: string
  ): boolean {
    const key = this.generateQuoteKey(fromTokenAddress, toTokenAddress, amount, slippagePercent);
    return this.has(key);
  }

  /**
   * 清理特定代币对的报价
   */
  public clearPairQuotes(fromTokenAddress: string, toTokenAddress: string): number {
    const prefix = `quote:${fromTokenAddress}:${toTokenAddress}:`;
    return this.deleteByPrefix(prefix);
  }
}

/**
 * 多层缓存管理器
 */
export class TieredCacheManager<T = any> {
  private l1Cache: SmartCacheManager<T>; // 内存缓存
  private l2Cache?: SmartCacheManager<T>; // 可选的二级缓存

  constructor(
    l1Config: Partial<CacheConfig> = {},
    l2Config?: Partial<CacheConfig>
  ) {
    this.l1Cache = new SmartCacheManager<T>(l1Config, CacheStrategy.LRU);
    
    if (l2Config) {
      this.l2Cache = new SmartCacheManager<T>(
        { ...l2Config, quoteTtl: l2Config.quoteTtl || 300000 }, // 5分钟默认TTL
        CacheStrategy.LFU
      );
    }
  }

  /**
   * 获取数据，自动处理多层缓存
   */
  public async get(key: string, dataProvider?: () => Promise<T>): Promise<T | undefined> {
    // 先从L1缓存获取
    let data = this.l1Cache.get(key);
    if (data) {
      return data;
    }

    // 再从L2缓存获取
    if (this.l2Cache) {
      data = this.l2Cache.get(key);
      if (data) {
        // 将数据提升到L1缓存
        this.l1Cache.set(key, data);
        return data;
      }
    }

    // 如果都没有，使用数据提供者获取
    if (dataProvider) {
      try {
        data = await dataProvider();
        this.set(key, data);
        return data;
      } catch (error) {
        console.warn(`Failed to fetch data for key: ${key}`, error);
      }
    }

    return undefined;
  }

  /**
   * 设置数据到多层缓存
   */
  public set(key: string, data: T, ttl?: number): void {
    this.l1Cache.set(key, data, ttl);
    
    if (this.l2Cache) {
      const l2Ttl = ttl ? ttl * 5 : undefined; // L2缓存TTL更长
      this.l2Cache.set(key, data, l2Ttl);
    }
  }

  /**
   * 删除数据
   */
  public delete(key: string): boolean {
    const l1Deleted = this.l1Cache.delete(key);
    const l2Deleted = this.l2Cache?.delete(key) || false;
    return l1Deleted || l2Deleted;
  }

  /**
   * 获取综合统计信息
   */
  public getStats(): { l1: CacheStats; l2?: CacheStats } {
    return {
      l1: this.l1Cache.getStats(),
      l2: this.l2Cache?.getStats()
    };
  }

  /**
   * 清空所有缓存
   */
  public clear(): void {
    this.l1Cache.clear();
    this.l2Cache?.clear();
  }

  /**
   * 销毁缓存管理器
   */
  public destroy(): void {
    this.l1Cache.destroy();
    this.l2Cache?.destroy();
  }
}

// 导出默认的缓存管理器实例
export const quoteCacheManager = new QuoteCacheManager({
  quoteTtl: 30000,
  maxSize: 100,
  cleanupInterval: 60000
});