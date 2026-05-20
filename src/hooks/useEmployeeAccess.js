// src/hooks/useEmployeeAccess.js
import { useState } from 'react';
import { currentConfig } from '../config/factoryConfig';

const CHECK_API = `${currentConfig.apiBase}/checkEmployeeStatus`;

export function useEmployeeAccess() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    /**
     * Check if employee has access to the app
     * @param {string} empno
     * @param {string} fingerprintHash - Mã định danh phần cứng
     */
    const checkAccess = async (empno, fingerprintHash) => {
        if (!empno) return { allow: false, is_manager: 0 };

        setLoading(true);
        setError(null);

        try {
            const isNumeric = /^\d+$/.test(empno);

            if (isNumeric) {
                const empnoWithoutLeadingZeros = empno.replace(/^0+/, '') || '0';
                if (empno !== empnoWithoutLeadingZeros) {
                    const [result1, result2] = await Promise.all([
                        checkSingleEmpno(empno, fingerprintHash),
                        checkSingleEmpno(empnoWithoutLeadingZeros, fingerprintHash)
                    ]);
                    if (result1.allow) return result1;
                    if (result2.allow) return result2;
                    return result1;
                }
            }

            return await checkSingleEmpno(empno, fingerprintHash);
        } catch (err) {
            console.error('Employee access check error:', err);
            setError(err.message);
            return { allow: true, is_manager: 0 }; 
        } finally {
            setLoading(false);
        }
    };

    /**
     * 2. Làm mới Access bằng Refresh Token
     */
    const refreshAccess = async (empno, refreshToken, fingerprintHash) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${currentConfig.apiBase}/refreshToken`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    empno, 
                    refresh_token: refreshToken,
                    fingerprint_hash: fingerprintHash
                }),
            });

            // Nếu Server báo hết hạn/sai (401, 403)
            if (response.status === 401 || response.status === 403) {
                const data = await response.json();
                setLoading(false);
                return { allow: false, reason: data.reason || 'expired' };
            }

            // Nếu lỗi khác (500, 404...)
            if (!response.ok) {
                setLoading(false);
                return { allow: false, reason: 'api_error' };
            }

            const data = await response.json();
            setLoading(false);
            return { allow: true, ...data };
        } catch (err) {
            console.error("Refresh token failed:", err);
            setLoading(false);
            return { allow: false, reason: 'network_error' };
        }
    };

    /**
     * Check single empno against API
     */
    const checkSingleEmpno = async (empno, fingerprintHash) => {
        try {
            const response = await fetch(CHECK_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    empno,
                    fingerprint_hash: fingerprintHash 
                }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            if (data.allow === true) {
                console.log(`[Access] Allowed for ${empno}`);
                return { 
                    allow: true, 
                    is_manager: data.is_manager || 0,
                    session_token: data.session_token || null,
                    refresh_token: data.refresh_token || null // Trả về mã 7 ngày
                };
            } else {
                console.warn(`[Access] Denied for ${empno}. Reason: ${data.reason}`, data.message);
                return {
                    allow: false,
                    reason: data.reason || 'denied',
                    detected_ip: data.detected_ip || null
                };
            }
        } catch (err) {
            console.error(`Check failed for empno ${empno}:`, err);
            throw err;
        }
    };

    return { checkAccess, refreshAccess, loading, error };
}

