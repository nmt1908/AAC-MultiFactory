
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IoCalendarOutline, IoChevronBack, IoChevronForward, IoClose } from 'react-icons/io5';

export default function DateRangePicker({ fromDate, toDate, onChange }) {
    const { t } = useTranslation('common');
    const [isOpen, setIsOpen] = useState(false);

    // Internal state for calendar navigation
    const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

    const containerRef = useRef(null);

    // Parse initial dates or default to empty
    const start = fromDate ? new Date(fromDate) : null;
    const end = toDate ? new Date(toDate) : null;

    // Handle click outside to close
    useEffect(() => {
        function handleClickOutside(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (month, year) => new Date(year, month, 1).getDay();

    const handleDateClick = (day) => {
        // Create date at noon to avoid timezone shift at midnight
        const clickedDate = new Date(currentYear, currentMonth, day, 12, 0, 0);

        // Manual YYYY-MM-DD formatting to ensure local date is used
        const year = clickedDate.getFullYear();
        const month = String(clickedDate.getMonth() + 1).padStart(2, '0');
        const d = String(clickedDate.getDate()).padStart(2, '0');
        const formatted = `${year}-${month}-${d}`;

        if (!start || (start && end)) {
            // Start new range (or single date)
            onChange(formatted, formatted); // Set both to same initially -> Single date
        } else {
            // We have start, verify if clicked is before or after
            if (formatted < (fromDate || '')) { // Simple string comparison works for YYYY-MM-DD
                // New start
                onChange(formatted, formatted);
            } else {
                // Complete range
                onChange(fromDate, formatted);
                setIsOpen(false); // Close on selection complete
            }
        }
    };

    const handlePrevMonth = () => {
        if (currentMonth === 0) {
            setCurrentMonth(11);
            setCurrentYear(prev => prev - 1);
        } else {
            setCurrentMonth(prev => prev - 1);
        }
    };

    const handleNextMonth = () => {
        if (currentMonth === 11) {
            setCurrentMonth(0);
            setCurrentYear(prev => prev + 1);
        } else {
            setCurrentMonth(prev => prev + 1);
        }
    };

    const renderCalendar = () => {
        const daysInMonth = getDaysInMonth(currentMonth, currentYear);
        const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
        const blanks = Array(firstDay).fill(null);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

        const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        const isDateSelected = (day) => {
            const d = new Date(currentYear, currentMonth, day);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const dateVal = String(d.getDate()).padStart(2, '0');
            const formatted = `${year}-${month}-${dateVal}`;

            return formatted === fromDate || formatted === toDate;
        };

        const isDateInRange = (day) => {
            if (!start || !end) return false;
            const d = new Date(currentYear, currentMonth, day);
            return d > start && d < end;
        };

        return (
            <div className="p-4 w-[280px]">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <button onClick={handlePrevMonth} className="text-slate-400 hover:text-white p-1"><IoChevronBack /></button>
                    <div className="flex gap-2">
                        <span className="bg-slate-800 px-3 py-1 rounded-md text-sm font-semibold">{monthNames[currentMonth]}</span>
                        <span className="bg-slate-800 px-3 py-1 rounded-md text-sm font-semibold">{currentYear}</span>
                    </div>
                    <button onClick={handleNextMonth} className="text-slate-400 hover:text-white p-1"><IoChevronForward /></button>
                </div>

                {/* Week days */}
                <div className="grid grid-cols-7 mb-2">
                    {weekDays.map(d => <div key={d} className="text-center text-xs text-slate-500 py-1">{d}</div>)}
                </div>

                {/* Days */}
                <div className="grid grid-cols-7 gap-1">
                    {blanks.map((_, i) => <div key={`blank-${i}`} />)}
                    {days.map(day => {
                        const isSelected = isDateSelected(day);
                        const isInRange = isDateInRange(day);
                        return (
                            <button
                                key={day}
                                onClick={() => handleDateClick(day)}
                                className={`
                  h-8 w-8 rounded-md text-sm flex items-center justify-center transition
                  ${isSelected ? 'bg-slate-600 text-white font-bold' : ''}
                  ${isInRange ? 'bg-slate-800/50 text-white' : ''}
                  ${!isSelected && !isInRange ? 'text-slate-300 hover:bg-slate-800' : ''}
                `}
                            >
                                {day}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Format display text
    let displayText = t('manageEvents.filters.selectDate', 'Select date');
    if (fromDate) {
        if (toDate && toDate !== fromDate) {
            displayText = `${fromDate} — ${toDate}`; // Range
        } else {
            displayText = fromDate; // Single date
        }
    }

    const clearDates = (e) => {
        e.stopPropagation();
        onChange('', '');
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
          flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-medium w-[220px] transition
          ${isOpen ? 'border-sky-500 ring-1 ring-sky-500/20 bg-slate-900 text-white' : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'}
        `}
            >
                <div className="flex items-center gap-2">
                    <IoCalendarOutline className="text-slate-400 text-sm" />
                    <span className="truncate">{displayText}</span>
                </div>
                {fromDate && (
                    <div onClick={clearDates} className="hover:bg-slate-700 p-0.5 rounded-full">
                        <IoClose className="text-slate-400" />
                    </div>
                )}
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 z-50 bg-[#1a1c23] border border-slate-700 rounded-xl shadow-2xl text-white">
                    {renderCalendar()}
                </div>
            )}
        </div>
    );
}
