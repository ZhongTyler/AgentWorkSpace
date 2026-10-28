// Modified by AgentWorkSpace: strict anonymous read-only adapter; no credential access or fallback on denied responses.
// Local strict-reader adapter: anonymous only; no environment or credential-file reads.
export const credentialManager = Object.freeze({getAuthHeaders: () => ({}), getCredentials: () => null});
