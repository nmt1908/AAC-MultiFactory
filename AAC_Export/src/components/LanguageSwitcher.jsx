import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Language Switcher Component
 * @param {Object} props
 * @param {Function} props.onChangeLanguage - callback when language changes
 */
function LanguageSwitcher({ onChangeLanguage }) {
    const { i18n } = useTranslation();

    return (
        <div className="flex items-center gap-1 bg-white/80 border border-slate-200 rounded-full px-2 py-1 text-[11px] text-slate-700 shadow-sm">
            <button
                onClick={() => onChangeLanguage?.('vi')}
                className={`px-2 py-0.5 rounded-full ${i18n.language?.startsWith('vi')
                    ? 'bg-slate-900 text-white'
                    : 'hover:bg-slate-100'
                    }`}
            >
                VI
            </button>
            <button
                onClick={() => onChangeLanguage?.('en')}
                className={`px-2 py-0.5 rounded-full ${i18n.language?.startsWith('en')
                    ? 'bg-slate-900 text-white'
                    : 'hover:bg-slate-100'
                    }`}
            >
                EN
            </button>
            <button
                onClick={() => onChangeLanguage?.('zh-TW')}
                className={`px-2 py-0.5 rounded-full ${i18n.language === 'zh-TW'
                    ? 'bg-slate-900 text-white'
                    : 'hover:bg-slate-100'
                    }`}
            >
                繁
            </button>
        </div>
    );
}

export default React.memo(LanguageSwitcher);
