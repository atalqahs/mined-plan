import { useCallback } from 'react';
import { isDomainError } from '@/domain/rules/errors';
import { errorMessage } from '@/presentation/i18n/ar';
import { useUi } from '@/presentation/state/uiStore';

/**
 * Runs a command and converts domain errors into Arabic toasts.
 * Returns the command result, or undefined if it failed.
 */
export function useSafeCommand() {
  return useCallback(<T,>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (isDomainError(e)) useUi.getState().toast({ message: errorMessage[e.code], tone: 'warning' });
      else {
        console.error(e);
        useUi.getState().toast({ message: 'حدث خطأ غير متوقع. لم تُفقد أي بيانات محفوظة.', tone: 'danger' });
      }
      return undefined;
    }
  }, []);
}
