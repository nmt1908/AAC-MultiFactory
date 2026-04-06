import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FaUser, FaLock } from "react-icons/fa";
import backgroundWithOutLogo from "../assets/images/backgroundWithOutLogo.png";
import { useEmployeeAccess } from "../hooks/useEmployeeAccess";
import { currentConfig } from "../config/factoryConfig";
import { getBrowserFingerprint } from "../utils/fingerprint"; // Import utility lấy vân tay


const LOGIN_API = currentConfig.factoryId === 'vg'
    ? "http://gmo021.cansportsvg.com/api/global-user/login"
    : `${currentConfig.apiBase}/ch-login-aac`;

export default function Login({ onLoginSuccess }) {
    const { t } = useTranslation("common");
    const { checkAccess } = useEmployeeAccess();

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(true); // Mặc định bật Remember Me (7 ngày)
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [fingerprint, setFingerprint] = useState("");

    // Lấy vân tay trình duyệt khi component mount
    useEffect(() => {
        getBrowserFingerprint().then(uid => setFingerprint(uid));

        // Kiểm tra lý do bị đá (nếu có) từ App.jsx
        const hash = window.location.hash;
        if (hash.includes('reason=kicked')) {
            setError("Tài khoản của bạn vừa đăng nhập ở một thiết bị khác. Bạn đã bị đăng xuất để bảo mật.");
        } else if (hash.includes('reason=refresh_token_expired')) {
            setError("Phiên làm việc 7 ngày đã hết hạn. Vui lòng đăng nhập lại.");
        }
    }, []);

    // Extract login logic to a separate function
    const handleLogin = async (loginUser, loginPass) => {
        setError("");

        // Validation
        if (!loginUser.trim()) {
            setError(t("login.errors.usernameRequired"));
            return;
        }
        if (!loginPass.trim()) {
            setError(t("login.errors.passwordRequired"));
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(LOGIN_API, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: loginUser.trim(),
                    password: loginPass.trim(),
                }),
            });

            const text = await response.text();
            let data;
            try {
                // If text doesn't look like JSON, don't even try to parse
                const trimmed = text.trim();
                if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                    throw new Error("Non-JSON response");
                }
                data = JSON.parse(text);
            } catch (e) {
                // API returned non-JSON (e.g. "wrong") -> Treat as Invalid Credentials
                console.warn("Login response was not JSON:", text);
                throw new Error(t("login.errors.invalidCredentials"));
            }

            if (!response.ok) {
                throw new Error(data.message || t("login.errors.invalidCredentials"));
            }

            // Extract user data from API response
            const userData = {
                name: data.name || loginUser,
                empno: data.empno || data.username,
                username: data.username || loginUser,
                token: data.session_token || "authenticated",
                // Initial value from login response (might be overridden by checkAccess)
                is_manager: data.is_manager || data.isDeptManager || 0,
            };

            // Check employee access BEFORE storing session
            // Gửi kèm fingerprint_hash để server nhận diện phần cứng
            const accessResult = await checkAccess(userData.empno, fingerprint);

            // Update user data with latest manager status and tokens
            if (accessResult && accessResult.allow) {
                userData.is_manager = accessResult.is_manager;
                userData.token = accessResult.session_token || userData.token;
                userData.refreshToken = accessResult.refresh_token; // Lưu mã refresh (7 ngày)
                userData.fingerprint = fingerprint; 
            }

            if (!accessResult.allow) {
                // Handle concurrent login blocking
                if (accessResult.reason === 'concurrent_login') {
                    const ip = accessResult.detected_ip || '127.0.0.1';
                    setError(`Tài khoản đang đăng nhập tại IP: ${ip}.\nVui lòng đăng xuất ở thiết bị khác và thử lại.`);
                    setLoading(false);
                    return;
                }

                // CRITICAL: Do NOT store session for unauthorized users
                // Clear any existing session
                localStorage.removeItem("authToken");
                localStorage.removeItem("userData");
                sessionStorage.removeItem("authToken");
                sessionStorage.removeItem("userData");

                // Pass userData but mark as unauthorized (for other denial reasons)
                onLoginSuccess?.(userData, false);
                return;
            }

            // Only store session if user has access
            if (rememberMe) {
                localStorage.setItem("authToken", userData.token);
                localStorage.setItem("userData", JSON.stringify(userData));
            } else {
                sessionStorage.setItem("authToken", userData.token);
                sessionStorage.setItem("userData", JSON.stringify(userData));
            }

            onLoginSuccess?.(userData, true);
        } catch (err) {
            console.error("Login error:", err);
            setError(err.message || t("login.errors.networkError"));
        } finally {
            setLoading(false);
        }
    };

    // Auto-login logic removed as requested to prevent persistent session issues after logout.
    // The vue-session-key check caused immediate re-login upon component mount.

    const handleSubmit = async (e) => {
        e.preventDefault();
        await handleLogin(username, password);
    };

    return (
        <div className="w-screen h-screen flex items-center justify-center overflow-hidden">
            {/* Background image */}
            <div
                className="absolute inset-0 overflow-hidden"
                style={{
                    backgroundImage: `url(${backgroundWithOutLogo})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat'
                }}
            >
                <div className="absolute inset-0 bg-white/30" />
            </div>

            {/* Login Card */}
            <div className="relative w-full max-w-md mx-4 p-8 bg-white rounded-3xl shadow-xl border border-slate-200">
                {/* Logo/Title */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white mb-4 shadow-lg overflow-hidden ">
                        <img src={(import.meta.env.BASE_URL + (import.meta.env.VITE_APP_LOGO || 'logo_ch.png')).replace(/\/\//g, '/')} alt="Logo" className="w-12 h-12 object-contain" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">{t("login.title")}</h1>
                    <p className="text-sm text-slate-500">{t("login.subtitle")}</p>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center">
                        {error}
                    </div>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Username */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            {t("login.username")}
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <FaUser className="h-4 w-4 text-slate-400" />
                            </div>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder={t("login.usernamePlaceholder")}
                                className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-shadow"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Password */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            {t("login.password")}
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <FaLock className="h-4 w-4 text-slate-400" />
                            </div>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={t("login.passwordPlaceholder")}
                                className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-shadow"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {/* Remember Me */}
                    <div className="flex items-center">
                        <input
                            id="rememberMe"
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="h-4 w-4 text-slate-900 accent-slate-900 focus:ring-slate-900 border-slate-300 rounded cursor-pointer"
                            disabled={loading}
                        />
                        <label htmlFor="rememberMe" className="ml-2 block text-sm text-slate-700 cursor-pointer">
                            {t("login.rememberMe")}
                        </label>
                    </div>

                    {/* Login Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                        {loading ? t("login.loggingIn") : t("login.loginButton")}
                    </button>
                </form>

                {/* Footer */}
                <div className="mt-6 text-center text-xs text-slate-500">
                    {t("login.footer")}
                </div>
            </div>
        </div>
    );
}
