import axios from 'axios';
import { env } from '../config/env';

let offsetMs = 0;
let lastSync = 0;
let syncPromise: Promise<void> | null = null;

const MAX_STALE_MS = 60_000; // 1 min
const MAX_OFFSET_BEFORE_FORCE = 5_000; // 5 seconds tolerance

const sanitizeBase = (base: string) => base.replace(/\/$/, '');

const timeEndpoints = Array.from(
  new Set([
    `${sanitizeBase(env.okxApiBase)}/api/v5/public/time`,
    'https://www.okx.com/api/v5/public/time'
  ])
);

const fetchServerTime = async () => {
  let lastError: unknown;

  for (const url of timeEndpoints) {
    try {
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data?.code !== '0') {
        throw new Error(response.data?.msg || '无法获取 OKX 服务器时间');
      }

      const serverTs = Number(response.data?.data?.[0]?.ts);
      if (!Number.isFinite(serverTs)) {
        throw new Error('OKX 服务器时间返回格式异常');
      }

      offsetMs = serverTs - Date.now();
      lastSync = Date.now();
      return;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError ?? new Error('无法同步 OKX 时间');
};

const shouldSync = () => {
  if (lastSync === 0) {
    return true;
  }

  const stale = Date.now() - lastSync > MAX_STALE_MS;
  const driftTooLarge = Math.abs(offsetMs) > MAX_OFFSET_BEFORE_FORCE;
  return stale || driftTooLarge;
};

export const ensureTimeSync = async () => {
  if (!shouldSync()) {
    return;
  }

  if (!syncPromise) {
    syncPromise = fetchServerTime()
      .catch((error) => {
        if (lastSync === 0) {
          throw error;
        }
        console.warn('[x402] 同步 OKX 时间失败，将继续使用上一轮偏移', error);
      })
      .finally(() => {
        syncPromise = null;
      });
  }

  await syncPromise;
};

export const getOkxIsoTimestamp = async () => {
  await ensureTimeSync();
  return new Date(Date.now() + offsetMs).toISOString();
};

export const startTimeSyncScheduler = () => {
  // 先尝试同步一次，但不要阻塞启动
  ensureTimeSync().catch((error) => {
    console.warn('[x402] 初始化时间同步失败，稍后将重试', error);
  });

  setInterval(() => {
    ensureTimeSync().catch((error) => {
      console.warn('[x402] 定时同步时间失败', error);
    });
  }, MAX_STALE_MS);
};
