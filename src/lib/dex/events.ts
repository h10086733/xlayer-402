/**
 * DEX交换服务的事件发射器
 */

import { SwapEvent, SwapEventType, SwapEventCallback } from './types';

/**
 * 事件发射器类
 */
export class DexEventEmitter {
  private listeners = new Map<SwapEventType, Set<SwapEventCallback>>();
  private globalListeners = new Set<SwapEventCallback>();
  private eventHistory: SwapEvent[] = [];
  private readonly maxHistorySize = 1000;

  /**
   * 添加事件监听器
   */
  public on(eventType: SwapEventType, callback: SwapEventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    
    const listeners = this.listeners.get(eventType)!;
    listeners.add(callback);

    // 返回取消监听的函数
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(eventType);
      }
    };
  }

  /**
   * 添加一次性事件监听器
   */
  public once(eventType: SwapEventType, callback: SwapEventCallback): () => void {
    const onceCallback: SwapEventCallback = (event: SwapEvent) => {
      callback(event);
      unsubscribe();
    };

    const unsubscribe = this.on(eventType, onceCallback);
    return unsubscribe;
  }

  /**
   * 添加全局事件监听器（监听所有事件）
   */
  public onAll(callback: SwapEventCallback): () => void {
    this.globalListeners.add(callback);

    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * 移除事件监听器
   */
  public off(eventType: SwapEventType, callback: SwapEventCallback): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * 移除所有事件监听器
   */
  public removeAllListeners(eventType?: SwapEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
      this.globalListeners.clear();
    }
  }

  /**
   * 发射事件
   */
  public emit(eventType: SwapEventType, data: any, transactionHash?: string, blockNumber?: number): void {
    const event: SwapEvent = {
      type: eventType,
      timestamp: Date.now(),
      data,
      transactionHash,
      blockNumber
    };

    // 添加到历史记录
    this.addToHistory(event);

    // 通知特定事件监听器
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }

    // 通知全局监听器
    this.globalListeners.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error(`Error in global event listener:`, error);
      }
    });
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: SwapEvent): void {
    this.eventHistory.push(event);
    
    // 保持历史记录大小限制
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * 获取事件历史
   */
  public getEventHistory(
    eventType?: SwapEventType,
    limit?: number,
    startTime?: number,
    endTime?: number
  ): SwapEvent[] {
    let events = this.eventHistory;

    // 按事件类型过滤
    if (eventType) {
      events = events.filter(event => event.type === eventType);
    }

    // 按时间范围过滤
    if (startTime || endTime) {
      events = events.filter(event => {
        if (startTime && event.timestamp < startTime) return false;
        if (endTime && event.timestamp > endTime) return false;
        return true;
      });
    }

    // 限制结果数量
    if (limit) {
      events = events.slice(-limit);
    }

    return events;
  }

  /**
   * 清理历史记录
   */
  public clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 获取监听器数量
   */
  public getListenerCount(eventType?: SwapEventType): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size || 0;
    } else {
      let total = this.globalListeners.size;
      this.listeners.forEach(listeners => {
        total += listeners.size;
      });
      return total;
    }
  }

  /**
   * 检查是否有监听器
   */
  public hasListeners(eventType: SwapEventType): boolean {
    return this.getListenerCount(eventType) > 0 || this.globalListeners.size > 0;
  }
}

/**
 * 事件工具类
 */
export class DexEventUtils {
  /**
   * 等待特定事件
   */
  static waitForEvent(
    emitter: DexEventEmitter,
    eventType: SwapEventType,
    timeout: number = 30000,
    condition?: (event: SwapEvent) => boolean
  ): Promise<SwapEvent> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let unsubscribe: () => void;

      // 设置超时
      timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeout);

      // 监听事件
      unsubscribe = emitter.on(eventType, (event: SwapEvent) => {
        if (!condition || condition(event)) {
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(event);
        }
      });
    });
  }

  /**
   * 等待多个事件中的任意一个
   */
  static waitForAnyEvent(
    emitter: DexEventEmitter,
    eventTypes: SwapEventType[],
    timeout: number = 30000
  ): Promise<SwapEvent> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      const unsubscribeFunctions: (() => void)[] = [];

      const cleanup = () => {
        clearTimeout(timeoutId);
        unsubscribeFunctions.forEach(fn => fn());
      };

      // 设置超时
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for any of events: ${eventTypes.join(', ')}`));
      }, timeout);

      // 监听所有指定事件
      eventTypes.forEach(eventType => {
        const unsubscribe = emitter.on(eventType, (event: SwapEvent) => {
          cleanup();
          resolve(event);
        });
        unsubscribeFunctions.push(unsubscribe);
      });
    });
  }

  /**
   * 创建事件过滤器
   */
  static createFilter(
    condition: (event: SwapEvent) => boolean
  ): SwapEventCallback {
    return (event: SwapEvent) => {
      if (condition(event)) {
        // 这里可以添加过滤后的处理逻辑
        console.log('Event passed filter:', event);
      }
    };
  }

  /**
   * 创建事件日志记录器
   */
  static createLogger(
    logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info',
    customLogger?: (message: string, event: SwapEvent) => void
  ): SwapEventCallback {
    return (event: SwapEvent) => {
      const message = `[${event.type}] ${new Date(event.timestamp).toISOString()}`;
      
      if (customLogger) {
        customLogger(message, event);
      } else {
        switch (logLevel) {
          case 'debug':
            console.debug(message, event);
            break;
          case 'info':
            console.info(message, event.data);
            break;
          case 'warn':
            console.warn(message, event.data);
            break;
          case 'error':
            console.error(message, event.data);
            break;
        }
      }
    };
  }

  /**
   * 创建事件统计收集器
   */
  static createStatsCollector(): {
    callback: SwapEventCallback;
    getStats: () => Record<SwapEventType, number>;
    reset: () => void;
  } {
    const stats = new Map<SwapEventType, number>();

    return {
      callback: (event: SwapEvent) => {
        const count = stats.get(event.type) || 0;
        stats.set(event.type, count + 1);
      },
      getStats: () => {
        const result: Record<SwapEventType, number> = {} as any;
        stats.forEach((count, type) => {
          result[type] = count;
        });
        return result;
      },
      reset: () => {
        stats.clear();
      }
    };
  }
}

/**
 * 预定义的事件监听器工厂
 */
export class DexEventListenerFactory {
  /**
   * 创建进度跟踪监听器
   */
  static createProgressTracker(
    onProgress: (progress: number, message: string) => void
  ): SwapEventCallback {
    const progressMap: Record<SwapEventType, number> = {
      [SwapEventType.QUOTE_REQUESTED]: 10,
      [SwapEventType.QUOTE_RECEIVED]: 20,
      [SwapEventType.SWAP_INITIATED]: 30,
      [SwapEventType.APPROVAL_REQUIRED]: 35,
      [SwapEventType.APPROVAL_COMPLETED]: 40,
      [SwapEventType.SIMULATION_STARTED]: 50,
      [SwapEventType.SIMULATION_COMPLETED]: 60,
      [SwapEventType.TRANSACTION_SUBMITTED]: 70,
      [SwapEventType.TRANSACTION_CONFIRMED]: 90,
      [SwapEventType.SWAP_COMPLETED]: 100,
      [SwapEventType.QUOTE_FAILED]: 0,
      [SwapEventType.SWAP_FAILED]: 0,
      [SwapEventType.TRANSACTION_FAILED]: 0
    };

    return (event: SwapEvent) => {
      const progress = progressMap[event.type] || 0;
      const message = DexEventListenerFactory.getEventMessage(event.type);
      onProgress(progress, message);
    };
  }

  /**
   * 创建错误处理监听器
   */
  static createErrorHandler(
    onError: (error: Error, event: SwapEvent) => void
  ): SwapEventCallback {
    const errorEvents = [
      SwapEventType.QUOTE_FAILED,
      SwapEventType.SWAP_FAILED,
      SwapEventType.TRANSACTION_FAILED
    ];

    return (event: SwapEvent) => {
      if (errorEvents.includes(event.type)) {
        const error = event.data.error || new Error(event.data.message || 'Unknown error');
        onError(error, event);
      }
    };
  }

  /**
   * 获取事件消息
   */
  private static getEventMessage(eventType: SwapEventType): string {
    const messages: Record<SwapEventType, string> = {
      [SwapEventType.QUOTE_REQUESTED]: '正在获取价格报价...',
      [SwapEventType.QUOTE_RECEIVED]: '价格报价获取成功',
      [SwapEventType.QUOTE_FAILED]: '价格报价获取失败',
      [SwapEventType.SWAP_INITIATED]: '开始执行交换...',
      [SwapEventType.APPROVAL_REQUIRED]: '需要代币授权',
      [SwapEventType.APPROVAL_COMPLETED]: '代币授权完成',
      [SwapEventType.SIMULATION_STARTED]: '开始交易模拟...',
      [SwapEventType.SIMULATION_COMPLETED]: '交易模拟完成',
      [SwapEventType.TRANSACTION_SUBMITTED]: '交易已提交',
      [SwapEventType.TRANSACTION_CONFIRMED]: '交易已确认',
      [SwapEventType.TRANSACTION_FAILED]: '交易执行失败',
      [SwapEventType.SWAP_COMPLETED]: '交换完成',
      [SwapEventType.SWAP_FAILED]: '交换失败'
    };

    return messages[eventType] || '未知状态';
  }
}

// 导出全局事件发射器实例
export const dexEventEmitter = new DexEventEmitter();