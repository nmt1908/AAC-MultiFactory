import { useState, useCallback } from 'react';

/**
 * Hook quản lý alert dialog state (success/error popup)
 * @returns {Object} alert state và methods
 */
export function useAlertDialog() {
    const [alertState, setAlertState] = useState({
        open: false,
        title: '',
        message: '',
        animationData: null,
    });

    const showAlert = useCallback(({ title, message, animationData }) => {
        setAlertState({
            open: true,
            title,
            message,
            animationData,
        });
    }, []);

    const closeAlert = useCallback(() => {
        setAlertState((prev) => ({
            ...prev,
            open: false,
        }));
    }, []);

    return {
        alertState,
        showAlert,
        closeAlert,
    };
}
