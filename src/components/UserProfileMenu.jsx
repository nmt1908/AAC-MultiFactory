// src/components/UserProfileMenu.jsx
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FaChevronDown, FaSignOutAlt, FaHome } from "react-icons/fa";

export default function UserProfileMenu({ userData, onLogout }) {
    const { t } = useTranslation("common");
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    const handleLogout = () => {
        setIsOpen(false);
        onLogout?.();
    };

    if (!userData) return null;

    return (
        <div className="relative" ref={menuRef}>
            {/* User Chip */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 border border-slate-200 hover:border-slate-300"
            >
                <span className="text-xs font-bold text-slate-900 whitespace-nowrap">
                    {userData.name || userData.username} - {userData.empno || userData.username}
                </span>
                <FaChevronDown
                    className={`w-2.5 h-2.5 text-slate-600 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                        }`}
                />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50">

                    <div className="h-px bg-slate-200" />
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <FaSignOutAlt className="w-4 h-4" />
                        <span>{t("userMenu.logout")}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
