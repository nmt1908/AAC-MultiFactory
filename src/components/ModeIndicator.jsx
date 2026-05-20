import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Mode Indicator Component
 * @param {Object} props
 * @param {boolean} props.editMode - current edit mode state
 */
function ModeIndicator({ editMode }) {
    const { t } = useTranslation('common');

    return (
        <span
            className={`px-3 py-1 rounded-full text-xs font-medium border ${editMode
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
        >
            {editMode ? t('mode.edit') : t('mode.view')}
        </span>
    );
}

export default React.memo(ModeIndicator);
