/**
 * DEX交换服务的交易验证器
 */

import { ethers } from 'ethers';
import {
  SwapQuoteRequest,
  SwapExecuteRequest,
  TransactionData,
  TokenInfo,
  NetworkConfig,
  DexConfig
} from './types';
import { DexSwapError, DexErrorFactory } from './errors';

/**
 * 验证结果接口
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 交易验证器类
 */
export class DexTransactionValidator {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly networkConfig: NetworkConfig;

  constructor(provider: ethers.JsonRpcProvider, networkConfig: NetworkConfig) {
    this.provider = provider;
    this.networkConfig = networkConfig;
  }

  /**
   * 验证钱包地址
   */
  public validateAddress(address: string, fieldName: string = 'address'): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!address) {
      errors.push(`${fieldName} 不能为空`);
    } else if (!ethers.isAddress(address)) {
      errors.push(`${fieldName} 格式无效: ${address}`);
    } else if (address === ethers.ZeroAddress) {
      warnings.push(`${fieldName} 是零地址`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证金额
   */
  public validateAmount(
    amount: string | number,
    decimals: number = 18,
    fieldName: string = 'amount'
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!amount && amount !== 0) {
      errors.push(`${fieldName} 不能为空`);
      return { isValid: false, errors, warnings };
    }

    const amountStr = amount.toString();
    
    // 检查是否为有效数字
    if (isNaN(Number(amountStr)) || Number(amountStr) < 0) {
      errors.push(`${fieldName} 必须是有效的正数: ${amountStr}`);
      return { isValid: false, errors, warnings };
    }

    const amountNum = Number(amountStr);

    // 检查是否为零
    if (amountNum === 0) {
      errors.push(`${fieldName} 不能为零`);
    }

    // 检查小数位数
    const decimalPlaces = amountStr.includes('.') ? amountStr.split('.')[1].length : 0;
    if (decimalPlaces > decimals) {
      errors.push(`${fieldName} 小数位数超过限制: ${decimalPlaces} > ${decimals}`);
    }

    // 检查是否过大
    const maxAmount = Number.MAX_SAFE_INTEGER / Math.pow(10, decimals);
    if (amountNum > maxAmount) {
      errors.push(`${fieldName} 过大: ${amountNum}`);
    }

    // 警告：非常小的金额
    if (amountNum < Math.pow(10, -decimals + 2)) {
      warnings.push(`${fieldName} 非常小，可能导致精度问题`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证滑点百分比
   */
  public validateSlippage(slippagePercent: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!slippagePercent) {
      errors.push('滑点百分比不能为空');
      return { isValid: false, errors, warnings };
    }

    const slippage = parseFloat(slippagePercent);

    if (isNaN(slippage)) {
      errors.push(`滑点百分比格式无效: ${slippagePercent}`);
      return { isValid: false, errors, warnings };
    }

    if (slippage < 0) {
      errors.push('滑点百分比不能为负数');
    } else if (slippage === 0) {
      warnings.push('滑点为0可能导致交易失败');
    } else if (slippage > 50) {
      warnings.push('滑点过大，可能存在风险');
    } else if (slippage > 20) {
      warnings.push('滑点较大，请谨慎操作');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证报价请求
   */
  public validateQuoteRequest(request: SwapQuoteRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证地址
    const fromAddressValidation = this.validateAddress(request.fromTokenAddress, 'fromTokenAddress');
    const toAddressValidation = this.validateAddress(request.toTokenAddress, 'toTokenAddress');
    const walletValidation = this.validateAddress(request.walletAddress, 'walletAddress');

    errors.push(...fromAddressValidation.errors);
    errors.push(...toAddressValidation.errors);
    errors.push(...walletValidation.errors);
    warnings.push(...fromAddressValidation.warnings);
    warnings.push(...toAddressValidation.warnings);
    warnings.push(...walletValidation.warnings);

    // 验证金额
    const amountValidation = this.validateAmount(request.amount);
    errors.push(...amountValidation.errors);
    warnings.push(...amountValidation.warnings);

    // 验证滑点
    if (request.slippagePercent) {
      const slippageValidation = this.validateSlippage(request.slippagePercent);
      errors.push(...slippageValidation.errors);
      warnings.push(...slippageValidation.warnings);
    }

    // 检查是否是相同代币
    if (request.fromTokenAddress.toLowerCase() === request.toTokenAddress.toLowerCase()) {
      errors.push('源代币和目标代币不能相同');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证交换执行请求
   */
  public validateSwapRequest(request: SwapExecuteRequest): ValidationResult {
    const result = this.validateQuoteRequest(request);

    // 验证最大滑点
    if (request.maxSlippagePercent) {
      const maxSlippageValidation = this.validateSlippage(request.maxSlippagePercent);
      result.errors.push(...maxSlippageValidation.errors);
      result.warnings.push(...maxSlippageValidation.warnings);

      // 检查最大滑点是否大于等于普通滑点
      if (request.slippagePercent && request.maxSlippagePercent) {
        const slippage = parseFloat(request.slippagePercent);
        const maxSlippage = parseFloat(request.maxSlippagePercent);
        if (maxSlippage < slippage) {
          result.errors.push('最大滑点不能小于普通滑点');
        }
      }
    }

    // 验证截止时间
    if (request.deadline) {
      const now = Math.floor(Date.now() / 1000);
      if (request.deadline <= now) {
        result.errors.push('截止时间已过期');
      } else if (request.deadline - now < 60) {
        result.warnings.push('截止时间过近，可能导致交易失败');
      } else if (request.deadline - now > 3600) {
        result.warnings.push('截止时间过长');
      }
    }

    // 验证Gas价格
    if (request.gasPrice) {
      const gasPriceValidation = this.validateAmount(request.gasPrice, 9, 'gasPrice');
      result.errors.push(...gasPriceValidation.errors);
      result.warnings.push(...gasPriceValidation.warnings);
    }

    // 验证Gas限制
    if (request.gasLimit) {
      const gasLimitValidation = this.validateAmount(request.gasLimit, 0, 'gasLimit');
      result.errors.push(...gasLimitValidation.errors);
      result.warnings.push(...gasLimitValidation.warnings);

      const gasLimit = Number(request.gasLimit);
      if (gasLimit < 21000) {
        result.errors.push('Gas限制过低');
      } else if (gasLimit > 10000000) {
        result.warnings.push('Gas限制过高');
      }
    }

    return {
      isValid: result.errors.length === 0,
      errors: result.errors,
      warnings: result.warnings
    };
  }

  /**
   * 验证交易数据
   */
  public validateTransactionData(txData: TransactionData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证to地址
    const toValidation = this.validateAddress(txData.to, 'to');
    errors.push(...toValidation.errors);
    warnings.push(...toValidation.warnings);

    // 验证data字段
    if (!txData.data || txData.data === '0x') {
      errors.push('交易data不能为空');
    } else if (!txData.data.startsWith('0x')) {
      errors.push('交易data格式无效：必须以0x开头');
    } else if (txData.data.length < 10) {
      warnings.push('交易data过短，可能无效');
    }

    // 验证value字段
    if (txData.value && txData.value !== '0') {
      const valueValidation = this.validateAmount(txData.value, 18, 'value');
      errors.push(...valueValidation.errors);
      warnings.push(...valueValidation.warnings);
    }

    // 验证gas字段
    if (txData.gas) {
      const gasValidation = this.validateAmount(txData.gas, 0, 'gas');
      errors.push(...gasValidation.errors);
      warnings.push(...gasValidation.warnings);
    }

    // 验证gasPrice字段
    if (txData.gasPrice) {
      const gasPriceValidation = this.validateAmount(txData.gasPrice, 9, 'gasPrice');
      errors.push(...gasPriceValidation.errors);
      warnings.push(...gasPriceValidation.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证代币信息
   */
  public validateTokenInfo(token: TokenInfo): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证地址
    const addressValidation = this.validateAddress(token.address, 'token address');
    errors.push(...addressValidation.errors);
    warnings.push(...addressValidation.warnings);

    // 验证symbol
    if (!token.symbol) {
      errors.push('代币符号不能为空');
    } else if (token.symbol.length > 20) {
      warnings.push('代币符号过长');
    }

    // 验证name
    if (!token.name) {
      errors.push('代币名称不能为空');
    } else if (token.name.length > 100) {
      warnings.push('代币名称过长');
    }

    // 验证精度
    if (token.decimals < 0 || token.decimals > 77) {
      errors.push(`代币精度无效: ${token.decimals}，必须在0-77之间`);
    } else if (token.decimals > 18) {
      warnings.push('代币精度过高，可能存在问题');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证DEX配置
   */
  public validateDexConfig(config: DexConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证链ID
    if (!config.chainIndex) {
      errors.push('链ID不能为空');
    } else if (config.chainIndex !== this.networkConfig.chainId) {
      warnings.push(`链ID不匹配：期望 ${this.networkConfig.chainId}，实际 ${config.chainIndex}`);
    }

    // 验证代币地址
    const fromValidation = this.validateAddress(config.fromTokenAddress, 'fromTokenAddress');
    const toValidation = this.validateAddress(config.toTokenAddress, 'toTokenAddress');
    errors.push(...fromValidation.errors, ...toValidation.errors);
    warnings.push(...fromValidation.warnings, ...toValidation.warnings);

    // 验证滑点
    const slippageValidation = this.validateSlippage(config.slippagePercent);
    errors.push(...slippageValidation.errors);
    warnings.push(...slippageValidation.warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证余额是否充足
   */
  public async validateBalance(
    tokenAddress: string,
    userAddress: string,
    requiredAmount: string,
    decimals: number = 18
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      let balance: bigint;

      if (tokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
        // 原生代币余额
        balance = await this.provider.getBalance(userAddress);
      } else {
        // ERC20代币余额
        const erc20Abi = [
          'function balanceOf(address owner) view returns (uint256)'
        ];
        const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
        balance = await contract.balanceOf(userAddress);
      }

      const requiredBigInt = ethers.parseUnits(requiredAmount, decimals);
      
      if (balance < requiredBigInt) {
        const balanceFormatted = ethers.formatUnits(balance, decimals);
        errors.push(`余额不足：需要 ${requiredAmount}，当前 ${balanceFormatted}`);
      } else {
        // 检查余额是否刚好够用（考虑Gas费）
        const ratio = (balance * 100n) / requiredBigInt;
        if (ratio < 110n) { // 少于110%
          warnings.push('余额较低，建议保留一些余量用于Gas费');
        }
      }
    } catch (error) {
      errors.push(`无法查询余额: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 验证授权额度
   */
  public async validateAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    requiredAmount: string,
    decimals: number = 18
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 原生代币不需要授权
      if (tokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
        return { isValid: true, errors, warnings };
      }

      const erc20Abi = [
        'function allowance(address owner, address spender) view returns (uint256)'
      ];
      const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
      const allowance = await contract.allowance(ownerAddress, spenderAddress);
      
      const requiredBigInt = ethers.parseUnits(requiredAmount, decimals);
      
      if (allowance < requiredBigInt) {
        const allowanceFormatted = ethers.formatUnits(allowance, decimals);
        errors.push(`授权不足：需要 ${requiredAmount}，当前 ${allowanceFormatted}`);
      }
    } catch (error) {
      errors.push(`无法查询授权额度: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 综合验证交换请求
   */
  public async validateCompleteSwapRequest(
    request: SwapExecuteRequest,
    fromToken: TokenInfo,
    toToken: TokenInfo
  ): Promise<ValidationResult> {
    const results: ValidationResult[] = [];

    // 基础请求验证
    results.push(this.validateSwapRequest(request));

    // 代币信息验证
    results.push(this.validateTokenInfo(fromToken));
    results.push(this.validateTokenInfo(toToken));

    // 余额验证
    const balanceResult = await this.validateBalance(
      request.fromTokenAddress,
      request.walletAddress,
      request.amount,
      fromToken.decimals
    );
    results.push(balanceResult);

    // 授权验证（如果需要）
    if (request.fromTokenAddress !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
      // 这里需要知道spender地址，通常是路由器合约地址
      // 由于这个信息可能在DexConfig中，这里先跳过
      // 在实际使用时应该传入spender地址
    }

    // 合并所有验证结果
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    results.forEach(result => {
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    });

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings
    };
  }
}

/**
 * 验证工具类
 */
export class ValidationUtils {
  /**
   * 检查是否为有效的以太坊地址
   */
  static isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * 检查是否为零地址
   */
  static isZeroAddress(address: string): boolean {
    return address === ethers.ZeroAddress;
  }

  /**
   * 标准化地址（转换为校验和格式）
   */
  static normalizeAddress(address: string): string {
    if (!ethers.isAddress(address)) {
      throw DexErrorFactory.invalidParameters('address', address, 'valid Ethereum address');
    }
    return ethers.getAddress(address);
  }

  /**
   * 解析金额字符串为BigInt
   */
  static parseAmount(amount: string, decimals: number): bigint {
    try {
      return ethers.parseUnits(amount, decimals);
    } catch (error) {
      throw DexErrorFactory.invalidParameters('amount', amount, `valid number with max ${decimals} decimals`);
    }
  }

  /**
   * 格式化BigInt金额为字符串
   */
  static formatAmount(amount: bigint, decimals: number): string {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * 检查金额是否为零
   */
  static isZeroAmount(amount: string): boolean {
    try {
      return ethers.parseUnits(amount, 18) === 0n;
    } catch {
      return false;
    }
  }

  /**
   * 比较两个金额
   */
  static compareAmounts(
    amount1: string,
    amount2: string,
    decimals: number = 18
  ): number {
    const bigint1 = ethers.parseUnits(amount1, decimals);
    const bigint2 = ethers.parseUnits(amount2, decimals);
    
    if (bigint1 < bigint2) return -1;
    if (bigint1 > bigint2) return 1;
    return 0;
  }

  /**
   * 验证并标准化滑点百分比
   */
  static normalizeSlippage(slippagePercent: string): string {
    const slippage = parseFloat(slippagePercent);
    if (isNaN(slippage) || slippage < 0 || slippage > 100) {
      throw DexErrorFactory.invalidParameters(
        'slippagePercent',
        slippagePercent,
        'valid percentage between 0 and 100'
      );
    }
    return slippage.toFixed(2);
  }
}