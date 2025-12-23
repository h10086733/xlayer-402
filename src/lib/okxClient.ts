import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { getOkxIsoTimestamp } from './timeSync';
import {
  OkxResponse,
  SettlementResult,
  SupportedChain,
  VerificationResult,
  SettleRequestBody
} from '../types/x402';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class OkxClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.okxApiBase,
      timeout: 10000
    });
  }

  private async buildHeaders(method: string, path: string, body?: unknown) {
    const timestamp = await getOkxIsoTimestamp();
    const payload = body ? JSON.stringify(body) : '';
    const prehash = `${timestamp}${method}${path}${payload}`;
    const signature = crypto
      .createHmac('sha256', env.okxSecretKey)
      .update(prehash)
      .digest('base64');

    const headers: any = {
      'OK-ACCESS-KEY': env.okxApiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-PASSPHRASE': env.okxPassphrase,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json'
    };

    // 添加PROJECT ID如果DEX API需要
    if (env.okxProjectId) {
      headers['OK-ACCESS-PROJECT'] = env.okxProjectId;
    }

    return headers;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers = await this.buildHeaders(method, path, body);
        const response = await this.client.request<OkxResponse<T>>({
          method,
          url: path,
          data: body,
          headers
        });

        if (response.data.code !== '0') {
          throw new Error(response.data.msg || 'OKX API error');
        }

        return response.data.data;
      } catch (error) {
        const axiosError = error as AxiosError<{ code?: string; msg?: string }>;
        const status = axiosError.response?.status;
        const apiCode = axiosError.response?.data?.code;
        const isRateLimit = status === 429 || apiCode === '50011';

        if (isRateLimit && attempt < maxRetries) {
          const backoff = 500 * Math.pow(2, attempt);
          await sleep(backoff);
          continue;
        }

        if (isRateLimit) {
          throw new Error('OKX 请求超过限速，请稍后重试或降低调用频率。');
        }

        throw error;
      }
    }

    throw new Error('OKX 请求失败');
  }

  async getSupportedChains() {
    return this.request<SupportedChain[]>('GET', '/api/v6/x402/supported');
  }

  async settle(body: SettleRequestBody) {
    return this.request<SettlementResult[]>('POST', '/api/v6/x402/settle', body);
  }

  async verify(body: SettleRequestBody) {
    return this.request<VerificationResult[]>('POST', '/api/v6/x402/verify', body);
  }

  // DEX 交换相关方法
  dex = {
    getQuote: async (params: {
      chainIndex: string;
      fromTokenAddress: string;
      toTokenAddress: string;
      amount: number;
      slippagePercent: string;
      userWalletAddress: string;
    }) => {
      try {
        const queryParams = new URLSearchParams({
          chainIndex: params.chainIndex,
          amount: params.amount.toString(),
          swapMode: 'exactIn',
          fromTokenAddress: params.fromTokenAddress,
          toTokenAddress: params.toTokenAddress,
          slippagePercent: params.slippagePercent,
          userWalletAddress: params.userWalletAddress
        });

        const path = `/api/v6/dex/aggregator/quote?${queryParams}`;
        
        const response = await this.client.get(path, {
          headers: await this.buildHeaders('GET', path)
        });

        return response.data;
      } catch (error) {
        console.error('OKX DEX 报价 API 调用失败:', error);
        throw error;
      }
    },

    executeSwap: async (params: {
      chainIndex: string;
      fromTokenAddress: string;
      toTokenAddress: string;
      amount: string;
      fromAddress: string;
      toAddress: string;
      slippagePercent: string;
    }) => {
      // 注意：真实的交换执行通常需要在客户端进行区块链交易
      // 这里返回交易数据，实际执行需要在用户端完成
      console.log('获取 OKX DEX 交换交易数据:', params);
      
      try {
        // 先获取报价和交易数据
        const swapData = await this.dex.getQuote({
          chainIndex: params.chainIndex,
          fromTokenAddress: params.fromTokenAddress,
          toTokenAddress: params.toTokenAddress,
          amount: parseInt(params.amount),
          slippagePercent: params.slippagePercent,
          userWalletAddress: params.fromAddress
        });

        return {
          data: [{
            txData: swapData.data?.[0], // 包含交易数据
            success: true,
            message: '交换数据获取成功，需要在区块链上执行交易'
          }]
        };
      } catch (error) {
        console.error('OKX DEX 交换数据获取失败:', error);
        return {
          data: [{
            success: false,
            errorMessage: `交换失败: ${error instanceof Error ? error.message : '未知错误'}`
          }]
        };
      }
    },

    // 获取swap交易数据
    getSwapTx: async (params: {
      chainIndex: string;
      fromTokenAddress: string;
      toTokenAddress: string;
      amount: number;
      slippagePercent: string;
      userWalletAddress: string;
    }) => {
      try {
        // 设置合理的deadline（当前时间 + 20分钟）
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        
        const queryParams = new URLSearchParams({
          chainIndex: params.chainIndex,
          amount: params.amount.toString(),
          swapMode: 'exactIn',
          fromTokenAddress: params.fromTokenAddress,
          toTokenAddress: params.toTokenAddress,
          slippagePercent: params.slippagePercent,
          userWalletAddress: params.userWalletAddress,
          deadline: deadline.toString() // 添加deadline参数
        });

        const path = `/api/v6/dex/aggregator/swap?${queryParams}`;
        
        const response = await this.client.get(path, {
          headers: await this.buildHeaders('GET', path)
        });

        return response.data;
      } catch (error) {
        console.error('OKX DEX 交易数据获取失败:', error);
        throw error;
      }
    }
  }
}

export const okxClient = new OkxClient();
