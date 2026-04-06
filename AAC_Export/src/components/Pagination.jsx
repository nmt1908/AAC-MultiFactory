
import React from 'react';
import { useTranslation } from 'react-i18next';
import { IoChevronBack, IoChevronForward } from "react-icons/io5";

export default function Pagination({ currentPage, totalPages, onPageChange, hasNext, hasPrev, totalItems }) {
    const { t } = useTranslation('common');

    if (totalPages <= 1) return null;

    // Generate page numbers to show (e.g., 1, ..., 4, 5, 6, ..., 10)
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            // Always show first, last, and window around current
            if (currentPage <= 3) {
                for (let i = 1; i <= 4; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push('...');
                pages.push(currentPage - 1);
                pages.push(currentPage);
                pages.push(currentPage + 1);
                pages.push('...');
                pages.push(totalPages);
            }
        }
        return pages;
    };

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2 border-t border-slate-200">
            <div className="text-xs text-slate-500">
                {t('manageEvents.pagination.showing', 'Showing')} <span className="font-semibold text-slate-700">{currentPage}</span> {t('manageEvents.pagination.of', 'of')} <span className="font-semibold text-slate-700">{totalPages}</span> {t('manageEvents.pagination.page', 'Page')}
                {totalItems > 0 && <span className="ml-2 hidden sm:inline">({totalItems} {t('manageEvents.pagination.items', 'items')})</span>}
            </div>

            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={!hasPrev}
                    className={`
            p-2 rounded-md transition
            ${!hasPrev ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100 cursor-pointer'}
          `}
                >
                    <IoChevronBack size={18} />
                </button>

                <div className="flex items-center gap-1">
                    {getPageNumbers().map((page, idx) => (
                        <React.Fragment key={idx}>
                            {page === '...' ? (
                                <span className="px-2 text-xs text-slate-400">...</span>
                            ) : (
                                <button
                                    onClick={() => onPageChange(page)}
                                    className={`
                    min-w-[32px] h-8 rounded-md text-xs font-semibold flex items-center justify-center transition
                    ${currentPage === page
                                            ? 'bg-slate-900 text-white shadow-md'
                                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                        }
                  `}
                                >
                                    {page}
                                </button>
                            )}
                        </React.Fragment>
                    ))}
                </div>

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasNext}
                    className={`
            p-2 rounded-md transition
            ${!hasNext ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100 cursor-pointer'}
          `}
                >
                    <IoChevronForward size={18} />
                </button>
            </div>
        </div>
    );
}
