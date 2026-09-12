/**
 * Command Code (Go) 额度渲染体：套餐 chip 行、月度额度、5小时与每周限额水位条、周期用量汇总。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandCodeQuotaState } from '@/types';
import { buildResetDisplay, formatQuotaResetTime, parseIsoToMs } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export const COMMANDCODE_5H_ROW_ID = 'commandcode:5h';
export const COMMANDCODE_WEEKLY_ROW_ID = 'commandcode:weekly';

const formatUsd = (dollars: number | null): string => {
  if (dollars === null || Number.isNaN(dollars)) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
};

const formatTokens = (tokens: number | null): string => {
  if (tokens === null || Number.isNaN(tokens)) return '--';
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
};

const formatPercent = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
};

export function CommandCodeQuotaBody({ quota, classes }: QuotaBodyProps<CommandCodeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const locale = i18n.resolvedLanguage;

  const summaryData = quota.quota;

  const urgentRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('commandcode', quota), now),
    [quota, now]
  );

  if (!summaryData) {
    return <div className={classes.quotaMessage}>{t('commandcode_quota.empty_data')}</div>;
  }

  // 1. 月度额度计算
  const monthlyCap = summaryData.monthlyCap > 0 ? summaryData.monthlyCap : 10;
  const monthlyRemaining = summaryData.monthlyCredits ?? 0;
  const monthlyPercent = Math.max(0, Math.min(100, (monthlyRemaining / monthlyCap) * 100));
  const monthlyUsed = Math.max(0, monthlyCap - monthlyRemaining);
  const monthlyAmountLabel = `${formatUsd(monthlyUsed)} / ${formatUsd(monthlyCap)}`;
  const monthlyResetIso = summaryData.currentPeriodEnd;
  const monthlyResetLabel = monthlyResetIso ? formatQuotaResetTime(monthlyResetIso) : null;
  const monthlyResetDisplay = monthlyResetIso
    ? buildResetDisplay(
        monthlyResetLabel === '-' ? null : t('commandcode_quota.reset_at', { time: monthlyResetLabel }),
        parseIsoToMs(monthlyResetIso),
        now,
        locale
      )
    : null;

  // 2. 5小时窗口计算
  const fiveHour = summaryData.fiveHour;
  let fiveHourRemainingPercent: number | null = null;
  let fiveHourAmountLabel = '--';
  let fiveHourResetDisplay: ReturnType<typeof buildResetDisplay> | null = null;
  const fiveHourSoon = urgentRowId === COMMANDCODE_5H_ROW_ID;

  if (fiveHour && fiveHour.cap > 0) {
    const remaining = Math.max(0, fiveHour.cap - fiveHour.used);
    fiveHourRemainingPercent = Math.max(0, Math.min(100, (remaining / fiveHour.cap) * 100));
    fiveHourAmountLabel = `${formatUsd(fiveHour.used)} / ${formatUsd(fiveHour.cap)}`;
    if (fiveHour.resetAt && fiveHour.resetAt > 0) {
      const resetLabel = formatQuotaResetTime(new Date(fiveHour.resetAt).toISOString());
      fiveHourResetDisplay = buildResetDisplay(
        resetLabel === '-' ? null : t('commandcode_quota.reset_at', { time: resetLabel }),
        fiveHour.resetAt,
        now,
        locale
      );
    }
  }

  // 3. 每周窗口计算
  const weekly = summaryData.weekly;
  let weeklyRemainingPercent: number | null = null;
  let weeklyAmountLabel = '--';
  let weeklyResetDisplay: ReturnType<typeof buildResetDisplay> | null = null;
  const weeklySoon = urgentRowId === COMMANDCODE_WEEKLY_ROW_ID;

  if (weekly && weekly.cap > 0) {
    const remaining = Math.max(0, weekly.cap - weekly.used);
    weeklyRemainingPercent = Math.max(0, Math.min(100, (remaining / weekly.cap) * 100));
    weeklyAmountLabel = `${formatUsd(weekly.used)} / ${formatUsd(weekly.cap)}`;
    if (weekly.resetAt && weekly.resetAt > 0) {
      const resetLabel = formatQuotaResetTime(new Date(weekly.resetAt).toISOString());
      weeklyResetDisplay = buildResetDisplay(
        resetLabel === '-' ? null : t('commandcode_quota.reset_at', { time: resetLabel }),
        weekly.resetAt,
        now,
        locale
      );
    }
  }

  const planId = summaryData.planId || 'individual-go';
  const planDisplay = planId.replace(/^individual-/, '').toUpperCase();
  const statusDisplay = summaryData.status || 'active';
  const usageSummary = summaryData.summary;

  return (
    <>
      {/* 顶部套餐 Chip 行 */}
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanItem}>
          <span className={classes.codexPlanLabel}>{t('commandcode_quota.plan_label')}</span>
          <span className={classes.codexPlanValue}>
            {planDisplay} ({statusDisplay})
          </span>
        </span>
      </div>

      {/* 5小时限额 */}
      {fiveHour && (
        <div
          className={classes.quotaRow}
          title={fiveHourSoon ? t('quota_management.soonest_row_hint') : undefined}
        >
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('commandcode_quota.five_hour_limit')}</span>
            <div className={classes.quotaMeta}>
              <span className={classes.quotaPercent}>
                {t('commandcode_quota.remaining_percent', {
                  percent: formatPercent(fiveHourRemainingPercent),
                })}
              </span>
              {fiveHourResetDisplay?.relative ? (
                <span
                  className={
                    fiveHourSoon
                      ? `${classes.quotaResetRelative} ${classes.quotaResetRelativeSoon}`
                      : classes.quotaResetRelative
                  }
                  title={fiveHourSoon ? t('quota_management.soonest_row_hint') : undefined}
                >
                  {t('commandcode_quota.refreshes_in', {
                    time: fiveHourResetDisplay.relative,
                  })}
                </span>
              ) : (
                <span className={classes.quotaResetRelative}>
                  {t('commandcode_quota.quota_sufficient')}
                </span>
              )}
            </div>
          </div>
          <QuotaMeter percent={fiveHourRemainingPercent} classes={classes} index={0} />
          <div className={classes.quotaSubRow}>
            <span className={classes.quotaAmount}>
              {t('commandcode_quota.used_amount', { amount: fiveHourAmountLabel })}
            </span>
            <span className={classes.quotaSubDate}>
              {fiveHourResetDisplay?.absolute
                ? fiveHourResetDisplay.absolute
                : t('commandcode_quota.window_ready')}
            </span>
          </div>
        </div>
      )}

      {/* 每周限额 */}
      {weekly && (
        <div
          className={classes.quotaRow}
          title={weeklySoon ? t('quota_management.soonest_row_hint') : undefined}
        >
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('commandcode_quota.weekly_limit')}</span>
            <div className={classes.quotaMeta}>
              <span className={classes.quotaPercent}>
                {t('commandcode_quota.remaining_percent', {
                  percent: formatPercent(weeklyRemainingPercent),
                })}
              </span>
              {weeklyResetDisplay?.relative ? (
                <span
                  className={
                    weeklySoon
                      ? `${classes.quotaResetRelative} ${classes.quotaResetRelativeSoon}`
                      : classes.quotaResetRelative
                  }
                  title={weeklySoon ? t('quota_management.soonest_row_hint') : undefined}
                >
                  {t('commandcode_quota.refreshes_in', {
                    time: weeklyResetDisplay.relative,
                  })}
                </span>
              ) : (
                <span className={classes.quotaResetRelative}>
                  {t('commandcode_quota.quota_sufficient')}
                </span>
              )}
            </div>
          </div>
          <QuotaMeter percent={weeklyRemainingPercent} classes={classes} index={1} />
          <div className={classes.quotaSubRow}>
            <span className={classes.quotaAmount}>
              {t('commandcode_quota.used_amount', { amount: weeklyAmountLabel })}
            </span>
            <span className={classes.quotaSubDate}>
              {weeklyResetDisplay?.absolute
                ? weeklyResetDisplay.absolute
                : t('commandcode_quota.cycle_ready')}
            </span>
          </div>
        </div>
      )}

      {/* 月度额度 */}
      <div className={classes.quotaRow}>
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{t('commandcode_quota.monthly_credits')}</span>
          <div className={classes.quotaMeta}>
            <span className={classes.quotaPercent}>
              {t('commandcode_quota.remaining_percent', {
                percent: formatPercent(monthlyPercent),
              })}
            </span>
            {monthlyResetDisplay?.relative ? (
              <span className={classes.quotaResetRelative}>
                {t('commandcode_quota.refreshes_in', {
                  time: monthlyResetDisplay.relative,
                })}
              </span>
            ) : (
              <span className={classes.quotaResetRelative}>
                {t('commandcode_quota.quota_sufficient')}
              </span>
            )}
          </div>
        </div>
        <QuotaMeter percent={monthlyPercent} classes={classes} index={2} />
        <div className={classes.quotaSubRow}>
          <span className={classes.quotaAmount}>
            {t('commandcode_quota.used_amount', { amount: monthlyAmountLabel })}
          </span>
          <span className={classes.quotaSubDate}>
            {monthlyResetDisplay?.absolute
              ? monthlyResetDisplay.absolute
              : t('commandcode_quota.cycle_ready')}
          </span>
        </div>
      </div>

      {/* 周期用量汇总小字 */}
      {usageSummary && (
        <div className={classes.codexPlan} style={{ marginTop: '4px', fontSize: '11px', opacity: 0.85 }}>
          <span className={classes.codexPlanLabel}>{t('commandcode_quota.summary_prefix')}</span>
          <span className={classes.codexPlanValue} style={{ fontWeight: 500, fontSize: '11px' }}>
            {t('commandcode_quota.summary_format', {
              count: (usageSummary.completedCount ?? 0).toLocaleString(),
              cost: formatUsd(usageSummary.totalCost ?? 0),
              in: formatTokens(usageSummary.totalTokensIn ?? 0),
              out: formatTokens(usageSummary.totalTokensOut ?? 0),
            })}
          </span>
        </div>
      )}
    </>
  );
}
