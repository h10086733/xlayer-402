import { Request, Response, NextFunction } from 'express';
import { templateAuthManager, SecureExtra } from '../lib/templateAuth';

// 扩展 Request 类型
declare global {
  namespace Express {
    interface Request {
      templatePermissions?: any;
      userAddress?: string;
    }
  }
}

export function validateTemplatePermission() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { paymentRequirements, paymentPayload } = req.body;
      
      if (!paymentPayload?.payload?.authorization?.from) {
        return res.status(400).json({
          error: 'MISSING_USER_ADDRESS',
          message: '缺少用户地址信息'
        });
      }

      const userAddress = paymentPayload.payload.authorization.from;
      req.userAddress = userAddress;

      // 检查是否配置了白名单
      const whitelistEnv = process.env.TOKEN_MINT_WHITELIST || '';
      const whitelistAddresses = whitelistEnv
        .split(',')
        .map(addr => addr.trim().toLowerCase())
        .filter(addr => addr.length > 0);

      // 如果没有配置白名单，允许所有用户通过，不需要签名验证
      if (whitelistAddresses.length === 0) {
        console.log('没有配置白名单，允许所有用户铸币');
        req.templatePermissions = { mint: true };
        return next();
      }

      // 有白名单配置时，必须进行签名验证
      
      // 检查是否有extra字段
      if (!paymentRequirements?.extra) {
        return res.status(400).json({
          error: 'MISSING_TEMPLATE_INFO',
          message: '缺少模板权限信息（已配置白名单，需要签名验证）'
        });
      }
      
      const extra = paymentRequirements.extra as SecureExtra;
      
      // 验证必需字段
      if (!extra.templateId || !extra.signature || !extra.timestamp) {
        return res.status(400).json({
          error: 'INVALID_TEMPLATE_FORMAT',
          message: '模板权限格式无效，缺少必要字段'
        });
      }
      
      // 验证签名
      const verification = templateAuthManager.verifyTemplateSignature(
        extra,
        userAddress
      );
      
      if (!verification.valid) {
        return res.status(403).json({
          error: 'TEMPLATE_AUTH_FAILED',
          message: `权限验证失败: ${verification.reason}`
        });
      }

      // 双重验证：检查白名单权限
      if (extra.templateId === 'token-mint') {
        const hasWhitelistPermission = templateAuthManager.checkWhitelistPermission(
          userAddress,
          extra.templateId
        );

        if (!hasWhitelistPermission) {
          return res.status(403).json({
            error: 'WHITELIST_ACCESS_DENIED',
            message: '用户不在铸币白名单中'
          });
        }

        // 验证是否有铸造权限
        if (!extra.permissions?.mint) {
          return res.status(403).json({
            error: 'INSUFFICIENT_MINT_PERMISSIONS',
            message: '没有铸造权限'
          });
        }
      }
      
      // 将验证后的权限信息添加到请求中
      req.templatePermissions = extra.permissions;
      next();
      
    } catch (error) {
      console.error('Template validation error:', error);
      res.status(500).json({
        error: 'TEMPLATE_VALIDATION_ERROR',
        message: '模板验证过程出错'
      });
    }
  };
}

// 仅验证白名单的中间件（用于某些不需要签名的场景）
export function validateWhitelistOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { paymentPayload } = req.body;
      const userAddress = paymentPayload?.payload?.authorization?.from;

      if (!userAddress) {
        return res.status(400).json({
          error: 'MISSING_USER_ADDRESS',
          message: '缺少用户地址信息'
        });
      }

      const hasPermission = templateAuthManager.checkWhitelistPermission(
        userAddress,
        'token-mint'
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'WHITELIST_ACCESS_DENIED',
          message: '用户不在授权白名单中'
        });
      }

      req.userAddress = userAddress;
      next();
      
    } catch (error) {
      console.error('Whitelist validation error:', error);
      res.status(500).json({
        error: 'WHITELIST_VALIDATION_ERROR',
        message: '白名单验证过程出错'
      });
    }
  };
}