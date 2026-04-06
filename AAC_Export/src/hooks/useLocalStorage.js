import { useState, useEffect } from 'react';

/**
 * Hook để sync state với localStorage
 * @param {string} key - localStorage key
 * @param {*} initialValue - giá trị mặc định nếu localStorage chưa có
 * @returns {[any, Function]} - [value, setValue]
 */
export function useLocalStorage(key, initialValue) {
    // Khởi tạo state từ localStorage
    const [storedValue, setStoredValue] = useState(() => {
        if (typeof window === 'undefined') return initialValue;

        try {
            const item = window.localStorage.getItem(key);
            if (!item) return initialValue;

            const parsed = JSON.parse(item);
            return Array.isArray(initialValue) && !Array.isArray(parsed)
                ? initialValue
                : parsed;
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error);
            return initialValue;
        }
    });

    // Persist vào localStorage mỗi khi state thay đổi
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            // Giới hạn array size nếu là array (tránh localStorage quá lớn)
            let valueToStore = storedValue;
            if (Array.isArray(storedValue) && storedValue.length > 500) {
                valueToStore = storedValue.slice(-500);
                setStoredValue(valueToStore);
            }

            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.warn(`Error setting localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
