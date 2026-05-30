import Constants from 'expo-constants';

const expoConfig = Constants.expoConfig ?? (Constants.manifest as any) ?? {};
const extra = (expoConfig.extra ?? {}) as {
  apiBaseUrl?: string;
  expoPublicDomain?: string;
};

const defaultApiBaseUrl = 'https://workspaceapi-server-production-a6c2.up.railway.app';

export function getApiBase() {
  if (typeof extra.apiBaseUrl === 'string' && extra.apiBaseUrl.trim().length > 0) {
    return extra.apiBaseUrl.trim();
  }

  if (typeof extra.expoPublicDomain === 'string' && extra.expoPublicDomain.trim().length > 0) {
    return `https://${extra.expoPublicDomain.trim()}`;
  }

  return defaultApiBaseUrl;
}

export function getPublicDomain() {
  return typeof extra.expoPublicDomain === 'string' ? extra.expoPublicDomain.trim() : '';
}
