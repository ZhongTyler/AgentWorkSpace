/**
 * 配置文件 - 集中管理所有配置项
 */
import { SUPPORTED_LANGUAGES, } from "./bilibili/types.js";
import { isSupportedLanguage, validateLanguage, } from "./utils/validation.js";
// 默认配置
export const DEFAULT_CONFIG = {
    rateLimitMs: 500, // 请求间隔 500ms
    wbiCacheExpirationMs: 60 * 60 * 1000, // 1小时缓存过期
    requestTimeoutMs: 10000, // 10秒超时
    maxCacheSize: 100, // 最大缓存条目
    supportedLanguages: SUPPORTED_LANGUAGES,
    baseUrl: 'https://api.bilibili.com',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    referer: 'https://www.bilibili.com'
};
class ConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConfigurationError";
    }
}
const MAX_TIMER_DELAY_MS = 2_147_483_647;
function readPositiveSafeIntegerEnv(name, maximum) {
    const rawValue = process.env[name];
    if (rawValue === undefined)
        return undefined;
    if (!/^\d+$/.test(rawValue)) {
        throw new ConfigurationError(`${name} must be a positive safe integer written in base-10 digits`);
    }
    const parsed = Number(rawValue);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ConfigurationError(`${name} must be a positive safe integer written in base-10 digits`);
    }
    if (maximum !== undefined && parsed > maximum) {
        throw new ConfigurationError(`${name} must not exceed ${maximum} milliseconds`);
    }
    return parsed;
}
// 从环境变量加载配置（可选）
function loadConfigFromEnv() {
    const envConfig = {};
    const rateLimitMs = readPositiveSafeIntegerEnv("BILIBILI_RATE_LIMIT_MS", MAX_TIMER_DELAY_MS);
    if (rateLimitMs !== undefined) {
        envConfig.rateLimitMs = rateLimitMs;
    }
    const requestTimeoutMs = readPositiveSafeIntegerEnv("BILIBILI_REQUEST_TIMEOUT_MS", MAX_TIMER_DELAY_MS);
    if (requestTimeoutMs !== undefined) {
        envConfig.requestTimeoutMs = requestTimeoutMs;
    }
    // Cache capacity has no existing product-defined upper bound, so its
    // positive safe-integer boundary is intentionally not narrowed here.
    const maxCacheSize = readPositiveSafeIntegerEnv("BILIBILI_CACHE_SIZE");
    if (maxCacheSize !== undefined) {
        envConfig.maxCacheSize = maxCacheSize;
    }
    if (process.env.USER_AGENT) {
        envConfig.userAgent = process.env.USER_AGENT;
    }
    return envConfig;
}
// 合并配置：默认配置 + 环境变量配置
export const config = {
    ...DEFAULT_CONFIG,
    ...loadConfigFromEnv()
};
// 语言验证函数
export function isValidLanguage(lang) {
    return isSupportedLanguage(lang);
}
// 获取首选语言（未提供时返回默认；不支持的值必须显式报错）
export function getPreferredLanguage(preferredLang) {
    return validateLanguage(preferredLang) ?? SUPPORTED_LANGUAGES[0];
}
//# sourceMappingURL=config.js.map