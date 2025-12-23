import { config } from 'dotenv';

config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  okxApiKey: required('OKX_API_KEY'),
  okxSecretKey: required('OKX_SECRET_KEY'),
  okxPassphrase: required('OKX_API_PASSPHRASE'),
  okxProjectId: process.env.OKX_PROJECT_ID, // 可选，DEX API可能需要
  okxApiBase: process.env.OKX_API_BASE ?? 'https://web3.okx.com',
  
  // 代币铸造配置
  tokenMintMaxCount: Number(process.env.TOKEN_MINT_MAX_COUNT ?? 10),
  tokenMintCurrentCount: Number(process.env.TOKEN_MINT_CURRENT_COUNT ?? 0)
};
