/**
 * 错误处理模块
 * 提供详细的错误类型和错误处理功能
 */
export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
export class BVIdError extends ValidationError {
    constructor(message) {
        super(message);
        this.name = 'BVIdError';
    }
}
export class InputLengthError extends ValidationError {
    constructor(message) {
        super(message);
        this.name = 'InputLengthError';
    }
}
export class UnsafeInputError extends ValidationError {
    constructor(message) {
        super(message);
        this.name = 'UnsafeInputError';
    }
}
export class NetworkError extends Error {
    originalError;
    url;
    statusCode;
    constructor(message, originalError, url, statusCode) {
        super(message);
        this.originalError = originalError;
        this.url = url;
        this.statusCode = statusCode;
        this.name = 'NetworkError';
    }
}
export class TimeoutError extends Error {
    timeoutMs;
    constructor(message, timeoutMs) {
        super(message);
        this.timeoutMs = timeoutMs;
        this.name = 'TimeoutError';
    }
}
export class ResourceLimitError extends Error {
    resource;
    limit;
    constructor(message, resource, limit) {
        super(message);
        this.resource = resource;
        this.limit = limit;
        this.name = "ResourceLimitError";
    }
}
export class UpstreamResponseError extends Error {
    constructor(message = "Remote service returned an invalid response") {
        super(message);
        this.name = "UpstreamResponseError";
    }
}
export class BilibiliAPIError extends Error {
    code;
    statusCode;
    originalError;
    constructor(message, code, statusCode, originalError) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.originalError = originalError;
        this.name = 'BilibiliAPIError';
    }
}
export class PaidVideoError extends Error {
    constructor(message = '该视频为付费内容，无法获取完整信息') {
        super(message);
        this.name = 'PaidVideoError';
    }
}
export class NoSubtitleError extends Error {
    constructor(message = '该视频没有可用的字幕') {
        super(message);
        this.name = 'NoSubtitleError';
    }
}
export class AsrError extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.name = "AsrError";
    }
}
export class CommentsDisabledError extends Error {
    constructor(message = '该视频的评论功能已被禁用或限制访问') {
        super(message);
        this.name = 'CommentsDisabledError';
    }
}
/**
 * 分类错误类型
 */
export function categorizeError(error) {
    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            return new TimeoutError('Request aborted due to timeout', 30000);
        }
        if (error.name === 'FetchError' || error.code === 'ECONNRESET') {
            return new NetworkError('Network error', error);
        }
    }
    return error;
}
/**
 * 安全地处理输入验证错误
 */
export function handleValidationError(error) {
    if (error instanceof ValidationError) {
        throw error;
    }
    if (error instanceof Error) {
        throw new ValidationError(`Validation failed: ${error.message}`);
    }
    throw new ValidationError('Unknown validation error');
}
//# sourceMappingURL=errors.js.map