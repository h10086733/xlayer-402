import crypto from 'crypto';

export interface TemplatePermission {
  templateId: string;
  allowedAddresses: string[];
  requiredSignature: boolean;
  adminSignature?: string;
}

export interface SecureExtra {
  templateId: string;
  timestamp: number;
  signature: string;
  permissions: {
    mint?: boolean;
    admin?: boolean;
    custom?: Record<string, any>;
  };
}

export interface WhitelistEntry {
  address: string;
  templateId: string;
  permissions: string[];
  createdAt: number;
  expiresAt?: number;
}

class TemplateAuthManager {
  private whitelistCache = new Map<string, WhitelistEntry[]>();

  constructor(
    private privateKey: string,
    private publicKey: string
  ) {}

  // 生成模板权限签名
  generateTemplateSignature(
    templateId: string,
    userAddress: string,
    permissions: any,
    timestamp: number
  ): string {
    const message = `${templateId}:${userAddress.toLowerCase()}:${JSON.stringify(permissions)}:${timestamp}`;
    return crypto
      .createHmac('sha256', this.privateKey)
      .update(message)
      .digest('hex');
  }

  // 验证模板权限签名
  verifyTemplateSignature(
    extra: SecureExtra,
    userAddress: string
  ): { valid: boolean; reason?: string } {
    const currentTime = Date.now();
    const timeWindow = 10 * 60 * 1000; // 10分钟有效期
    
    // 检查时间戳
    if (currentTime - extra.timestamp > timeWindow) {
      return { valid: false, reason: '签名已过期' };
    }
    
    // 重新生成签名进行验证
    const expectedSignature = this.generateTemplateSignature(
      extra.templateId,
      userAddress,
      extra.permissions,
      extra.timestamp
    );
    
    if (expectedSignature !== extra.signature) {
      return { valid: false, reason: '签名验证失败' };
    }
    
    return { valid: true };
  }

  // 检查白名单权限
  checkWhitelistPermission(address: string, templateId: string): boolean {
    const normalizedAddress = address.toLowerCase();
    
    // 从环境变量读取白名单
    const whitelistEnv = process.env.TOKEN_MINT_WHITELIST || '';
    const whitelistAddresses = whitelistEnv
      .split(',')
      .map(addr => addr.trim().toLowerCase())
      .filter(addr => addr.length > 0);
    
    // 如果没有配置白名单，则允许所有用户
    if (whitelistAddresses.length === 0) {
      return true;
    }
    
    return whitelistAddresses.includes(normalizedAddress);
  }

  // 为白名单用户生成签名
  generateWhitelistSignature(
    userAddress: string,
    templateId: string,
    permissions: any = { mint: true }
  ): SecureExtra {
    const timestamp = Date.now();
    const signature = this.generateTemplateSignature(
      templateId,
      userAddress,
      permissions,
      timestamp
    );

    return {
      templateId,
      timestamp,
      signature,
      permissions
    };
  }

  // 验证用户是否有权限并生成签名
  authorizeUser(
    userAddress: string,
    templateId: string
  ): { authorized: boolean; signature?: SecureExtra; reason?: string } {
    // 检查是否在白名单中
    if (!this.checkWhitelistPermission(userAddress, templateId)) {
      return {
        authorized: false,
        reason: '用户不在授权白名单中'
      };
    }

    // 生成签名
    const signature = this.generateWhitelistSignature(userAddress, templateId);
    
    return {
      authorized: true,
      signature
    };
  }
}

// 导出单例实例
export const templateAuthManager = new TemplateAuthManager(
  process.env.TEMPLATE_AUTH_PRIVATE_KEY || 'default-private-key',
  process.env.TEMPLATE_AUTH_PUBLIC_KEY || 'default-public-key'
);