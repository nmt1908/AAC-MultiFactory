import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Manage Button Component - displays a "Manage" button in the top bar
 * @param {Object} props
 * @param {Function} props.onClick - callback when button clicked
 */
function ManageButton({ onClick }) {
    const { t } = useTranslation('common');

    const handleClick = () => {
        if (onClick) onClick();
    };

    return (
        <button
            onClick={handleClick}
            className="
        px-4 py-1.5 rounded-full text-xs font-medium
        bg-slate-900 text-white
        shadow-md hover:bg-slate-700
        transition-colors
      "
        >
            {t('button.manage')}
        </button>
    );
}

export default React.memo(ManageButton);
