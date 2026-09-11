/**
 * Command Code (Go) 额度数据层。React-free / SCSS-free。
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  CommandCodeBillingCreditsPayload,
  CommandCodeQuotaState,
  CommandCodeQuotaSummary,
  CommandCodeSubscriptionPayload,
  CommandCodeUsageSummaryPayload,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { createStatusError, isCommandCodeFile, isDisabledAuthFile } from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export const COMMANDCODE_BILLING_CREDITS_URL = 'https://api.commandcode.ai/alpha/billing/credits';
export const COMMANDCODE_SUBSCRIPTIONS_URL = 'https://api.commandcode.ai/alpha/billing/subscriptions';
export const COMMANDCODE_USAGE_SUMMARY_URL = 'https://api.commandcode.ai/alpha/usage/summary';

export const COMMANDCODE_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'cli',
  'x-command-code-version': '1.36.0',
  'x-cli-environment': 'production',
};

const resolveCommandCodeApiKey = (file: AuthFileItem): string => {
  const direct = (file as Record<string, unknown>)['api_key'] ?? (file as Record<string, unknown>)['apiKey'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const attributes =
    file.attributes && typeof file.attributes === 'object'
      ? (file.attributes as Record<string, unknown>)
      : null;
  if (attributes) {
    const attrKey = attributes['api_key'] ?? attributes['apiKey'];
    if (typeof attrKey === 'string' && attrKey.trim()) return attrKey.trim();
  }

  const metadata =
    file.metadata && typeof file.metadata === 'object'
      ? (file.metadata as Record<string, unknown>)
      : null;
  if (metadata) {
    const metaKey = metadata['api_key'] ?? metadata['apiKey'];
    if (typeof metaKey === 'string' && metaKey.trim()) return metaKey.trim();
  }

  return '';
};

const resolveCommandCodeProxyUrl = (file: AuthFileItem): string => {
  const direct = (file as Record<string, unknown>)['proxy_url'] ?? (file as Record<string, unknown>)['proxyUrl'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const attributes =
    file.attributes && typeof file.attributes === 'object'
      ? (file.attributes as Record<string, unknown>)
      : null;
  if (attributes) {
    const attrProxy = attributes['proxy_url'] ?? attributes['proxyUrl'];
    if (typeof attrProxy === 'string' && attrProxy.trim()) return attrProxy.trim();
  }

  const metadata =
    file.metadata && typeof file.metadata === 'object'
      ? (file.metadata as Record<string, unknown>)
      : null;
  if (metadata) {
    const metaProxy = metadata['proxy_url'] ?? metadata['proxyUrl'];
    if (typeof metaProxy === 'string' && metaProxy.trim()) return metaProxy.trim();
  }

  return '';
};

const fetchCommandCodeQuota = async (file: AuthFileItem, t: TFunction): Promise<CommandCodeQuotaSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  const apiKey = resolveCommandCodeApiKey(file);

  if (!authIndex && !apiKey) {
    throw new Error(t('commandcode_quota.missing_api_key'));
  }

  const proxyUrl = resolveCommandCodeProxyUrl(file);
  const headers: Record<string, string> = {
    ...COMMANDCODE_REQUEST_HEADERS,
    Authorization: apiKey ? `Bearer ${apiKey}` : 'Bearer $TOKEN$',
  };

  // 1. 获取 credits (核心)
  const creditsResult = await apiCallApi.request({
    ...(authIndex ? { authIndex } : {}),
    method: 'GET',
    url: COMMANDCODE_BILLING_CREDITS_URL,
    proxy_url: proxyUrl,
    header: headers,
  });

  if (creditsResult.statusCode < 200 || creditsResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(creditsResult), creditsResult.statusCode);
  }

  const creditsPayload = (
    typeof creditsResult.body === 'object' && creditsResult.body !== null
      ? creditsResult.body
      : creditsResult.bodyText
        ? JSON.parse(creditsResult.bodyText)
        : null
  ) as CommandCodeBillingCreditsPayload | null;

  if (!creditsPayload || !creditsPayload.credits) {
    throw new Error(t('commandcode_quota.empty_data'));
  }

  // 2. 并发获取 subscriptions 和 usage summary（容错处理，失败不中断整体）
  const [subResult, sumResult] = await Promise.allSettled([
    apiCallApi.request({
      ...(authIndex ? { authIndex } : {}),
      method: 'GET',
      url: COMMANDCODE_SUBSCRIPTIONS_URL,
      proxy_url: proxyUrl,
      header: headers,
    }),
    apiCallApi.request({
      ...(authIndex ? { authIndex } : {}),
      method: 'GET',
      url: COMMANDCODE_USAGE_SUMMARY_URL,
      proxy_url: proxyUrl,
      header: headers,
    }),
  ]);

  let subPayload: CommandCodeSubscriptionPayload | null = null;
  if (subResult.status === 'fulfilled' && subResult.value.statusCode >= 200 && subResult.value.statusCode < 300) {
    const b = subResult.value.body ?? (subResult.value.bodyText ? JSON.parse(subResult.value.bodyText) : null);
    if (typeof b === 'object' && b !== null) {
      subPayload = b as CommandCodeSubscriptionPayload;
    }
  }

  let sumPayload: CommandCodeUsageSummaryPayload | null = null;
  if (sumResult.status === 'fulfilled' && sumResult.value.statusCode >= 200 && sumResult.value.statusCode < 300) {
    const b = sumResult.value.body ?? (sumResult.value.bodyText ? JSON.parse(sumResult.value.bodyText) : null);
    if (typeof b === 'object' && b !== null) {
      sumPayload = b as CommandCodeUsageSummaryPayload;
    }
  }

  const fh = creditsPayload.windowLimits?.fiveHour;
  const wk = creditsPayload.windowLimits?.weekly;

  return {
    planId: subPayload?.data?.planId ?? 'individual-go',
    status: subPayload?.data?.status ?? 'active',
    currentPeriodEnd: subPayload?.data?.currentPeriodEnd ?? null,
    monthlyCredits: creditsPayload.credits.monthlyCredits ?? null,
    monthlyCap: 10, // Go 套餐默认封顶 $10
    fiveHour: fh
      ? {
          used: Number(fh.used ?? 0),
          cap: Number(fh.cap ?? 0),
          resetAt: fh.resetAt ? Number(fh.resetAt) : null,
        }
      : null,
    weekly: wk
      ? {
          used: Number(wk.used ?? 0),
          cap: Number(wk.cap ?? 0),
          resetAt: wk.resetAt ? Number(wk.resetAt) : null,
        }
      : null,
    summary: sumPayload
      ? {
          completedCount: sumPayload.completedCount ?? null,
          totalCost: sumPayload.totalCost ?? null,
          totalTokensIn: sumPayload.totalTokensIn ?? null,
          totalTokensOut: sumPayload.totalTokensOut ?? null,
        }
      : null,
  };
};

export const COMMANDCODE_CONFIG: QuotaProviderData<CommandCodeQuotaState, CommandCodeQuotaSummary> = {
  type: 'commandcode',
  i18nPrefix: 'commandcode_quota',
  filterFn: (file) => isCommandCodeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCommandCodeQuota,
  storeSelector: (state) => state.commandcodeQuota,
  storeSetter: 'setCommandCodeQuota',
  buildLoadingState: () => ({ status: 'loading', quota: null }),
  buildSuccessState: (quota) => ({ status: 'success', quota }),
  buildErrorState: (message, status) => ({
    status: 'error',
    quota: null,
    error: message,
    errorStatus: status,
  }),
};
