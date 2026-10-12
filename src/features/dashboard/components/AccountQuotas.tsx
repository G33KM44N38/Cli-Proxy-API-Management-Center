import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { Button } from '@/components/ui/Button';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QuotaCard } from '@/features/quota/components/QuotaCard';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useQuotaAutoLoad } from '@/features/quota/hooks/useQuotaAutoLoad';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import quotaStyles from '@/features/quota/QuotaPage.module.scss';
import styles from '../dashboard.module.scss';
import accountStyles from './AccountQuotas.module.scss';

export function AccountQuotas({
  files,
  connected,
  listError,
}: {
  files: AuthFileItem[] | null;
  connected: boolean;
  listError: boolean;
}) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const quotaStore = useQuotaStore();
  const entries = useMemo(() => classifyQuotaFiles(files ?? []), [files]);
  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const disabled = !connected || files === null;
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disabled);
  useQuotaAutoLoad(entries, disabled || batchLoading, loadQuota);

  return (
    <section className={styles.section} aria-labelledby="home-account-quotas">
      <header className={accountStyles.header}>
        <h2 id="home-account-quotas" className={styles.sectionTitle}>
          {t('nav.quota_management')}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || batchLoading || entries.length === 0}
          loading={batchLoading}
          onClick={() => void loadQuota(entries.filter(({ file }) => !file.disabled))}
        >
          {t('common.refresh')}
        </Button>
      </header>
      {listError && connected ? (
        <p className={styles.emptyNote} role="alert">
          {t('notification.refresh_failed')}
        </p>
      ) : files === null ? (
        <p className={styles.emptyNote} role="status">
          {t(connected ? 'common.loading' : 'dashboard.health_empty')}
        </p>
      ) : entries.length === 0 ? (
        <p className={styles.emptyNote}>{t('quota_management.empty_title')}</p>
      ) : (
        <div className={quotaStyles.grid}>
          {entries.map((entry) => {
            const key = getQuotaCacheKey(entry.file);
            const adapter = QUOTA_ADAPTERS[entry.type];
            return (
              <QuotaCard
                key={`${entry.type}:${key}`}
                entry={entry}
                quota={adapter.storeSelector(quotaStore)[key]}
                resolvedTheme={resolvedTheme}
                canRefresh={!disabled && !entry.file.disabled}
                resetting={resettingQuotaName === key}
                onRefresh={() => void refreshQuota(entry.file, adapter)}
                onReset={() => resetQuota(entry.file, adapter)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
