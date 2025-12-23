import { ethers } from 'ethers';

// ERC20 代币铸造合约 ABI （简化版）
const TOKEN_MINT_ABI = [
  "function mint(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

// NFT 铸造合约 ABI（ERC721简化版）
const NFT_MINT_ABI = [
  "function mint(address to, uint256 tokenId) external returns (bool)",
  "function mintTo(address to) external returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

export interface MintResult {
  success: boolean;
  txHash?: string;
  tokenId?: string;
  amount?: string;
  errorMessage?: string;
  gasUsed?: string;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals?: number;
  totalSupply?: string;
  contractAddress: string;
}

class TokenMintingService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor() {
    const rpcUrl = process.env.XLAYER_RPC_URL || 'https://rpc.xlayer.io';
    const privateKey = process.env.XLAYER_PRIVATE_KEY;
    
    if (!privateKey) {
      throw new Error('XLAYER_PRIVATE_KEY not configured');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  // 获取代币合约信息
  async getTokenInfo(contractAddress: string, isNFT: boolean = false): Promise<TokenInfo> {
    const abi = isNFT ? NFT_MINT_ABI : TOKEN_MINT_ABI;
    const contract = new ethers.Contract(contractAddress, abi, this.provider);

    try {
      const [name, symbol] = await Promise.all([
        contract.name(),
        contract.symbol()
      ]);

      let decimals: number | undefined;
      let totalSupply: string | undefined;

      if (!isNFT) {
        try {
          decimals = await contract.decimals();
          totalSupply = await contract.totalSupply();
        } catch (e) {
          console.warn('Unable to get decimals/totalSupply:', e);
        }
      }

      return {
        name,
        symbol,
        decimals,
        totalSupply: totalSupply?.toString(),
        contractAddress
      };
    } catch (error) {
      throw new Error(`Failed to get token info: ${error}`);
    }
  }

  // 铸造 ERC20 代币
  async mintToken(
    contractAddress: string, 
    toAddress: string, 
    amount: string
  ): Promise<MintResult> {
    try {
      const contract = new ethers.Contract(contractAddress, TOKEN_MINT_ABI, this.wallet);
      
      // 转换金额（假设18位小数）
      const mintAmount = ethers.parseEther(amount);
      
      console.log(`开始铸造 ${amount} 代币到 ${toAddress}`);
      
      // 估算 gas
      const gasEstimate = await contract.mint.estimateGas(toAddress, mintAmount);
      const gasLimit = gasEstimate * 12n / 10n; // 增加20% gas buffer
      
      // 发送交易
      const tx = await contract.mint(toAddress, mintAmount, {
        gasLimit
      });
      
      console.log(`交易发送成功，哈希: ${tx.hash}`);
      
      // 等待交易确认
      const receipt = await tx.wait();
      
      if (receipt?.status === 1) {
        console.log(`铸造成功！Gas 使用: ${receipt.gasUsed.toString()}`);
        return {
          success: true,
          txHash: tx.hash,
          amount,
          gasUsed: receipt.gasUsed.toString()
        };
      } else {
        return {
          success: false,
          errorMessage: '交易失败'
        };
      }
    } catch (error: any) {
      console.error('铸造代币失败:', error);
      return {
        success: false,
        errorMessage: error.message || '未知错误'
      };
    }
  }

  // 铸造 NFT
  async mintNFT(
    contractAddress: string, 
    toAddress: string, 
    tokenId?: string
  ): Promise<MintResult> {
    try {
      const contract = new ethers.Contract(contractAddress, NFT_MINT_ABI, this.wallet);
      
      console.log(`开始铸造 NFT 到 ${toAddress}`);
      
      let tx: ethers.ContractTransaction;
      
      if (tokenId) {
        // 铸造指定 ID 的 NFT
        const gasEstimate = await contract.mint.estimateGas(toAddress, tokenId);
        const gasLimit = gasEstimate * 12n / 10n;
        
        tx = await contract.mint(toAddress, tokenId, { gasLimit });
      } else {
        // 自动分配 ID 的 NFT
        const gasEstimate = await contract.mintTo.estimateGas(toAddress);
        const gasLimit = gasEstimate * 12n / 10n;
        
        tx = await contract.mintTo(toAddress, { gasLimit });
      }
      
      console.log(`NFT 交易发送成功，哈希: ${tx.hash}`);
      
      // 等待交易确认
      const receipt = await tx.wait();
      
      if (receipt?.status === 1) {
        // 尝试从事件中提取 tokenId
        let mintedTokenId = tokenId;
        if (!mintedTokenId && receipt.logs) {
          // 解析 Transfer 事件获取 tokenId
          for (const log of receipt.logs) {
            try {
              const parsed = contract.interface.parseLog(log);
              if (parsed?.name === 'Transfer' && parsed.args[0] === ethers.ZeroAddress) {
                mintedTokenId = parsed.args[2].toString();
                break;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
        
        console.log(`NFT 铸造成功！Token ID: ${mintedTokenId}, Gas 使用: ${receipt.gasUsed.toString()}`);
        return {
          success: true,
          txHash: tx.hash,
          tokenId: mintedTokenId,
          gasUsed: receipt.gasUsed.toString()
        };
      } else {
        return {
          success: false,
          errorMessage: 'NFT 交易失败'
        };
      }
    } catch (error: any) {
      console.error('铸造 NFT 失败:', error);
      return {
        success: false,
        errorMessage: error.message || '未知错误'
      };
    }
  }

  // 检查代币余额
  async getBalance(contractAddress: string, userAddress: string, isNFT: boolean = false): Promise<string> {
    try {
      const abi = isNFT ? NFT_MINT_ABI : TOKEN_MINT_ABI;
      const contract = new ethers.Contract(contractAddress, abi, this.provider);
      const balance = await contract.balanceOf(userAddress);
      return balance.toString();
    } catch (error) {
      console.error('获取余额失败:', error);
      return '0';
    }
  }

  // 验证合约地址
  async validateContract(contractAddress: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      const code = await this.provider.getCode(contractAddress);
      if (code === '0x') {
        return { valid: false, reason: '地址不是合约' };
      }
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: `验证失败: ${error}` };
    }
  }
}

export const tokenMintingService = new TokenMintingService();