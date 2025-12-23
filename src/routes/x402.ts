import { Router } from 'express';
import { ZodError } from 'zod';
import { okxClient } from '../lib/okxClient';
import { x402RequestSchema } from '../validation/x402Schema';
import { paymentConfig } from '../config/paymentConfig';
import { validateTemplatePermission } from '../middleware/templateAuth';
import { createXLayerUsdcWokbSwapService, SwapExecuteRequest } from '../lib/dex';
import * as redis from 'redis';

const router = Router();

// 创建Redis客户端
const redisClient = redis.createClient();
redisClient.connect().catch(console.error);

// Redis键名常量
const KEYS = {
  MINT_COUNT: (templateId: string) => `mint:${templateId}:count`,
  MINT_RECORDS: (address: string) => `mint:records:${address}`,
  PAYMENT_NONCE: (nonce: string) => `payment:nonce:${nonce}`,
  TEMPLATE_CONFIG: (templateId: string) => `template:config:${templateId}`
};

// 初始化模板配置
const initializeTemplateConfig = async (templateId: string) => {
  const configKey = KEYS.TEMPLATE_CONFIG(templateId);
  const exists = await redisClient.exists(configKey);
  
  if (!exists) {
    const config = {
      template_id: templateId,
      max_mint_count: '10', // 最大铸造数量
      token_name: 'x402',
      token_symbol: 'X402',
      token_address: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
      mint_price: '1' // USDC
    };
    await redisClient.hSet(configKey, config);
  }
};

// 获取当前铸造数量
const getCurrentMintCount = async (templateId: string): Promise<number> => {
  const countKey = KEYS.MINT_COUNT(templateId);
  const count = await redisClient.get(countKey);
  return count ? parseInt(count) : 0;
};

// 增加铸造数量
const incrementMintCount = async (templateId: string): Promise<number> => {
  const countKey = KEYS.MINT_COUNT(templateId);
  return await redisClient.incr(countKey);
};

// 检查是否可以铸造
const checkMintLimit = async (templateId: string) => {
  await initializeTemplateConfig(templateId);
  
  const configKey = KEYS.TEMPLATE_CONFIG(templateId);
  const config = await redisClient.hGetAll(configKey);
  const maxCount = parseInt(config.max_mint_count || '10');
  const currentCount = await getCurrentMintCount(templateId);
  
  const canMint = currentCount < maxCount;
  const remaining = Math.max(0, maxCount - currentCount);
  const isCompleted = currentCount >= maxCount;
  
  return {
    canMint,
    remaining,
    isCompleted,
    currentCount,
    maxCount
  };
};

// 检查nonce是否已存在
const checkNonceExists = async (nonce: string): Promise<boolean> => {
  const nonceKey = KEYS.PAYMENT_NONCE(nonce);
  return await redisClient.exists(nonceKey) > 0;
};

// 保存支付记录
const savePaymentRecord = async (nonce: string, paymentData: any) => {
  const nonceKey = KEYS.PAYMENT_NONCE(nonce);
  const recordData = {
    ...paymentData,
    created_at: new Date().toISOString(),
    status: 'paid'
  };
  await redisClient.setEx(nonceKey, 86400, JSON.stringify(recordData)); // 24小时过期
  return recordData;
};

// 保存铸造记录
const saveMintRecord = async (address: string, mintData: any) => {
  const recordsKey = KEYS.MINT_RECORDS(address);
  const mintRecord = {
    id: Date.now(),
    ...mintData,
    created_at: new Date().toISOString(),
    status: 'success'
  };
  
  // 将记录添加到用户的铸造记录列表中
  await redisClient.lPush(recordsKey, JSON.stringify(mintRecord));
  // 保持最近50条记录
  await redisClient.lTrim(recordsKey, 0, 49);
  
  return mintRecord;
};

router.get('/templates', (_req, res) => {
  res.json({
    data: {
      defaultOptionId: paymentConfig.defaultOptionId,
      options: paymentConfig.options.map(({ id, label, description }) => ({ id, label, description }))
    }
  });
});

router.get('/templates/:id', (req, res) => {
  const option = paymentConfig.options.find((opt) => opt.id === req.params.id);
  if (!option) {
    return res.status(404).json({
      error: 'TEMPLATE_NOT_FOUND',
      message: `未找到模板 ${req.params.id}`
    });
  }
  res.json({ data: option });
});

router.post('/verify', validateTemplatePermission(), async (req, res, next) => {
  try {
    const parsed = x402RequestSchema.parse(req.body);
    
    console.log('🔍 处理支付验证请求');
    
    const nonce = parsed.paymentPayload.payload.authorization.nonce;
    const templateId = parsed.paymentRequirements.extra?.templateId as string;
    
    // 1. 检查nonce是否已存在（防重复处理）
    const nonceExists = await checkNonceExists(nonce);
    if (nonceExists) {
      return res.status(400).json({
        error: 'DUPLICATE_NONCE',
        message: '该交易已处理过，请勿重复提交'
      });
    }
    
    // 2. 检查铸造限制（仅对token-mint模板）
    if (templateId === 'token-mint') {
      const limitCheck = await checkMintLimit(templateId);
      
      if (!limitCheck.canMint || limitCheck.isCompleted) {
        return res.status(400).json({
          error: 'MINT_LIMIT_REACHED',
          message: `铸造已达上限。当前: ${limitCheck.currentCount}/${limitCheck.maxCount}`
        });
      }
      
      console.log(`✅ 铸造验证通过，剩余 ${limitCheck.remaining} 个可铸造`);
    }
    
    // 3. 进行支付结算
    try {
      console.log('💰 开始支付结算...');
      const settleResult = await okxClient.settle(parsed);
      
      // 检查结算结果
      const settlementSuccess = settleResult.some(result => result.success);
      
      if (!settlementSuccess) {
        console.error('❌ 支付结算失败');
        return res.status(400).json({
          error: 'SETTLEMENT_FAILED',
          message: '支付结算失败'
        });
      }
      
      console.log('✅ 支付结算成功');
      
      // 4. 保存支付记录
      const paymentRecord = await savePaymentRecord(nonce, {
        nonce,
        from_address: parsed.paymentPayload.payload.authorization.from,
        to_address: parsed.paymentPayload.payload.authorization.to,
        value: parseFloat(parsed.paymentPayload.payload.authorization.value),
        template_id: templateId
      });
      
      let mintRecord: any = null;
      
      // 5. 处理代币铸造逻辑
      if (templateId === 'token-mint') {
        try {
          // 增加铸造计数
          const newCount = await incrementMintCount(templateId);
          console.log(`📈 铸造计数更新为: ${newCount}`);
          
          // 获取实际收到的金额
          const receivedAmount = parseFloat(parsed.paymentPayload.payload.authorization.value) / 1000000; // 转换为USDC
          console.log(`💱 开始兑换: ${receivedAmount} USDC -> OKB`);
          
          // 获取接收钱包地址
          const receivingWallet = process.env.X402_PAY_TO;
          if (!receivingWallet) {
            throw new Error('未配置接收钱包地址');
          }
          
          // 6. 执行USDC->OKB兑换
          try {
            const dexService = createXLayerUsdcWokbSwapService();
            
            const swapRequest: SwapExecuteRequest = {
              fromTokenAddress: '0x74b7f16337b8972027f6196a17a631ac6de26d22', // X Layer USDC
              toTokenAddress: '0xe538905cf8410324e03a5a23c1c177a474d59b2b',   // X Layer WOKB
              amount: Math.floor(receivedAmount * 1000000).toString(), // 转换为USDC的6位精度
              walletAddress: receivingWallet,
              slippagePercent: '10.0'
            };
            
            console.log('🔄 执行DEX交换...');
            const swapResult = await dexService.executeSwap(swapRequest);
            
            console.log('✅ DEX交换成功:', swapResult.transactionHash);
            
            // 7. 保存铸造记录
            mintRecord = await saveMintRecord(parsed.paymentPayload.payload.authorization.from, {
              payment_id: Date.now(),
              template_id: templateId,
              user_address: parsed.paymentPayload.payload.authorization.from,
              mint_count: 1,
              tx_hash: swapResult.transactionHash,
              received_amount: receivedAmount,
              swap_result: swapResult
            });
            
            console.log('🎉 代币铸造流程完成!');
            
          } catch (swapError) {
            console.error('❌ DEX交换失败:', swapError);
            
            // 即使交换失败，也记录铸造尝试
            mintRecord = await saveMintRecord(parsed.paymentPayload.payload.authorization.from, {
              payment_id: Date.now(),
              template_id: templateId,
              user_address: parsed.paymentPayload.payload.authorization.from,
              mint_count: 1,
              status: 'failed',
              error_message: (swapError as Error).message,
              received_amount: receivedAmount
            });
            
            throw swapError;
          }
          
        } catch (mintError) {
          console.error('❌ 铸造流程失败:', mintError);
          
          // 铸造失败时不回滚支付，但返回错误信息
          return res.status(500).json({
            error: 'MINT_FAILED',
            message: '支付成功但铸造失败',
            details: (mintError as Error).message,
            data: {
              payment_record_id: paymentRecord.nonce,
              auto_settlement: true,
              settlement_error: (mintError as Error).message
            }
          });
        }
      }
      
      // 8. 返回成功结果
      res.json({
        data: {
          payment_record_id: paymentRecord.nonce,
          auto_settlement: true,
          settlement_error: null,
          mint_record: mintRecord ? {
            mint_record_id: mintRecord.id,
            mint_count: mintRecord.mint_count,
            tx_hash: mintRecord.tx_hash
          } : null
        }
      });
      
    } catch (error) {
      console.error('❌ 支付处理异常:', error);
      
      res.status(500).json({
        error: 'PAYMENT_ERROR',
        message: '支付处理异常',
        details: (error as Error).message
      });
    }
    
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: '请求参数验证失败',
        details: error.errors
      });
    }
    
    console.error('❌ 未预期错误:', error);
    next(error);
  }
});

// 代币铸造进度
router.get('/token-mint/progress/:templateId', async (req, res, next) => {
  try {
    const { templateId } = req.params;
    
    if (templateId !== 'token-mint') {
      return res.status(404).json({
        error: 'CONFIG_NOT_FOUND',
        message: `未找到模板 ${templateId} 的铸造配置`
      });
    }
    
    const limitCheck = await checkMintLimit(templateId);
    
    const progress = {
      template_id: templateId,
      current_count: limitCheck.currentCount,
      max_count: limitCheck.maxCount,
      progress_percentage: Math.round((limitCheck.currentCount / limitCheck.maxCount) * 100),
      remaining_count: limitCheck.remaining,
      can_mint: limitCheck.canMint,
      is_completed: limitCheck.isCompleted,
      token_info: {
        name: 'x402',
        symbol: 'X402',
        address: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
        price: parseFloat(process.env.X402_VALUE || '1000000') / 1000000,
        price_source: 'X402_VALUE环境变量'
      }
    };
    
    res.json({ data: progress });
  } catch (error) {
    next(error);
  }
});

// 检查用户是否可以铸造
router.get('/token-mint/check/:templateId/:address', async (req, res, next) => {
  try {
    const { templateId, address } = req.params;
    
    if (templateId !== 'token-mint') {
      return res.status(404).json({
        error: 'CONFIG_NOT_FOUND',
        message: `未找到模板 ${templateId} 的配置`
      });
    }
    
    const limitCheck = await checkMintLimit(templateId);
    
    // 获取用户铸造记录数量
    const recordsKey = KEYS.MINT_RECORDS(address);
    const userMintCount = await redisClient.lLen(recordsKey);
    
    const result = {
      can_mint: limitCheck.canMint,
      remaining_total: limitCheck.remaining,
      is_completed: limitCheck.isCompleted,
      user_mint_count: userMintCount,
      reason: limitCheck.canMint 
        ? '可以铸造' 
        : limitCheck.isCompleted 
          ? '铸造已完成'
          : '已达到铸造限制'
    };
    
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// 获取用户铸造记录
router.get('/token-mint/records/:address', async (req, res, next) => {
  try {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    
    const recordsKey = KEYS.MINT_RECORDS(address);
    const recordsData = await redisClient.lRange(recordsKey, 0, limit - 1);
    
    const records = recordsData.map((data: string) => JSON.parse(data));
    
    res.json({
      data: records,
      meta: {
        count: records.length,
        limit
      }
    });
  } catch (error) {
    next(error);
  }
});

export const x402Router = router;