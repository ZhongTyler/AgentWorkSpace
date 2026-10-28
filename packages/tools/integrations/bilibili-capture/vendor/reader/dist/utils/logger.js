/**
 * 统一日志系统
 */
import { SECURITY_LIMITS } from "../security/limits.js";
import { truncateUtf8 } from "./bounded-text.js";
const SENSITIVE_KEY_PATTERN = /cookie|authorization|sessdata|bili_jct|dedeuserid|token|secret|(?:^|_)(?:mid|media_id|folder_id)$/i;
function redactString(value) {
    const prebounded = truncateUtf8(value, SECURITY_LIMITS.logStringBytes * 2, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    const redacted = prebounded
        .replace(/((?:BILIBILI_)?(?:SESSDATA|BILI_JCT|DEDEUSERID)\s*=\s*["']?)[^"';\s,]+/gi, "$1***")
        .replace(/(["'](?:SESSDATA|bili_jct|DedeUserID|BILIBILI_SESSDATA|BILIBILI_BILI_JCT|BILIBILI_DEDEUSERID|authorization|token|secret)["']\s*:\s*["'])[^"']*/gi, "$1***")
        .replace(/(\bAuthorization\s*[:=]\s*(?:Bearer\s+)?)[^\s"',;]+/gi, "$1***")
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
        .replace(/([?&](?:up_mid|media_id|folder_id|w_rid|upsig|deadline|expires|token|sign|wsSecret|wsTime)=)[^&\s"',]+/gi, "$1***")
        .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1***:***@")
        .replace(/\b[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\\\r\n]*/g, "[PRIVATE_PATH]")
        .replace(/\/(?:Users|home)\/[^/\s]+\/[^\s"',]*/g, "[PRIVATE_PATH]");
    return truncateUtf8(redacted, SECURITY_LIMITS.logStringBytes);
}
export function redactSecrets(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === "string") {
        return redactString(value);
    }
    if (typeof value === "bigint")
        return `${value.toString()}n`;
    if (typeof value === "symbol")
        return "[Symbol]";
    if (typeof value === "function")
        return "[Function]";
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (seen.has(value)) {
        return "[Circular]";
    }
    if (depth >= 8) {
        return "[MaxDepth]";
    }
    seen.add(value);
    if (value instanceof Error) {
        return {
            name: redactString(value.name),
            message: redactString(value.message),
        };
    }
    if (Array.isArray(value)) {
        const bounded = value
            .slice(0, 100)
            .map((item) => redactSecrets(item, seen, depth + 1));
        if (value.length > bounded.length)
            bounded.push("[Truncated]");
        return bounded;
    }
    const record = value;
    return Object.fromEntries(Object.keys(record)
        .slice(0, 100)
        .map((key) => {
        const boundedKey = truncateUtf8(key, 256);
        return [
            boundedKey,
            SENSITIVE_KEY_PATTERN.test(key)
                ? "***"
                : redactSecrets(record[key], seen, depth + 1),
        ];
    }));
}
export class Logger {
    static log(level, message, data, context) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message: redactString(message),
            data: redactSecrets(data),
            context: redactSecrets(context),
        };
        let serialized = JSON.stringify(entry);
        if (Buffer.byteLength(serialized, "utf8") > SECURITY_LIMITS.logEntryBytes) {
            serialized = JSON.stringify({
                timestamp: entry.timestamp,
                level,
                message: truncateUtf8(redactString(message), 512),
                data: "[Log entry truncated]",
                context: { type: "bounded-log" },
            });
        }
        // 使用 console.error 确保输出到 stderr，避免干扰 MCP 协议
        console.error(serialized);
    }
    static info(message, data, context) {
        this.log('info', message, data, context);
    }
    static warn(message, data, context) {
        this.log('warn', message, data, context);
    }
    static error(message, data, context) {
        this.log('error', message, data, context);
    }
    static debug(message, data, context) {
        if (process.env.BILIBILI_MCP_DEBUG !== '1') {
            return;
        }
        this.log('debug', message, data, context);
    }
    /**
     * 记录 API 请求
     */
    static logAPIRequest(method, url, params, duration) {
        this.info('API Request', {
            method,
            url,
            params,
            duration: duration ? `${duration}ms` : undefined
        }, { type: 'api-request' });
    }
    /**
     * 记录 API 响应
     */
    static logAPIResponse(method, url, status, duration, error) {
        const level = status >= 400 ? 'error' : 'info';
        this.log(level, 'API Response', {
            method,
            url,
            status,
            duration: duration ? `${duration}ms` : undefined,
            error
        }, { type: 'api-response' });
    }
    /**
     * 记录 MCP 工具调用
     */
    static logToolCall(toolName, args, duration) {
        this.info('Tool Call', {
            toolName,
            args,
            duration: duration ? `${duration}ms` : undefined
        }, { type: 'tool-call' });
    }
    /**
     * 记录 MCP 工具结果
     */
    static logToolResult(toolName, success, duration, error) {
        const level = success ? 'info' : 'error';
        this.log(level, 'Tool Result', {
            toolName,
            success,
            duration: duration ? `${duration}ms` : undefined,
            error
        }, { type: 'tool-result' });
    }
    /**
     * 创建带上下文的新 Logger 实例
     */
    static withContext(context) {
        return new Logger(context);
    }
    context;
    constructor(context = {}) {
        this.context = context;
    }
    info(message, data) {
        Logger.info(message, data, this.context);
    }
    warn(message, data) {
        Logger.warn(message, data, this.context);
    }
    error(message, data) {
        Logger.error(message, data, this.context);
    }
    debug(message, data) {
        Logger.debug(message, data, this.context);
    }
}
// 导出默认实例
export const logger = Logger;
//# sourceMappingURL=logger.js.map