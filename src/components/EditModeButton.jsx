import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Edit Mode Button Component
 * @param {Object} props
 * @param {boolean} props.editMode - current edit mode state
 * @param {Function} props.onToggle - callback when button clicked
 */
function EditModeButton({ editMode, onToggle }) {
    const { t } = useTranslation('common');

    return (
        <button
            onClick={onToggle}
            className="
        px-4 py-1.5 rounded-full text-xs font-medium
        bg-slate-900 text-white
        shadow-md hover:bg-slate-700
        transition-colors
      "
        >
            {editMode ? t('button.done') : t('button.edit')}
        </button>
    );
}

export default React.memo(EditModeButton);
