// src/App.jsx
import { useEffect, useState } from "react";
import "./i18n"; // 👈 import cấu hình i18n
import Home from "./screens/Home";
import SplashScreen from "./screens/SplashScreen";
import Login from "./screens/Login";
import ManageEvents from "./screens/ManageEvents";
import UnauthorizedDialog from "./components/UnauthorizedDialog";
import { useEmployeeAccess } from "./hooks/useEmployeeAccess";
import { currentConfig } from "./config/factoryConfig";
import { getBrowserFingerprint } from "./utils/fingerprint"; // Import utility

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userData, setUserData] = useState(null);
  const [hasAccess, setHasAccess] = useState(true);
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home' or 'manage'
  const [fingerprint, setFingerprint] = useState("");

  // Hook for access check
  const { checkAccess, refreshAccess } = useEmployeeAccess();

  // Heartbeat & Logout Logic
  useEffect(() => {
    if (!isAuthenticated || !userData?.empno) return;

    // 1. Heartbeat Interval (15s nhịp tim)
    const heartbeatInterval = setInterval(() => {
      try {
        if (!userData?.empno || !userData?.token || !fingerprint) return;

        // Keep-alive Logic gửi kèm dấu vân tay
        fetch(`${currentConfig.apiBase}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empno: userData.empno,
            session_token: userData.token,
            fingerprint_hash: fingerprint // Server check xem có đúng máy cũ không
          })
        })
          .then(res => res.json())
          .then(data => {
            // Nếu bị server từ chối vì lý do Session không khớp hoặc Vân tay khác
            if (data.status === 'ignored' && data.reason === 'session_mismatch') {
              console.warn("Session mismatch detected, attempting to heal session...");
              
              // THỬ TỰ CHỮA LÀNH: Gọi refreshAccess để lấy Token mới nhất đang có trên Server
              const storedUser = localStorage.getItem("userData") || sessionStorage.getItem("userData");
              if (storedUser) {
                  const user = JSON.parse(storedUser);
                  refreshAccess(user.empno, user.refreshToken, fingerprint).then(result => {
                      if (result.allow) {
                          const updatedUser = { ...user, token: result.session_token };
                          setUserData(updatedUser);
                          localStorage.setItem("userData", JSON.stringify(updatedUser));
                          console.log("Session healed successfully!");
                      } else {
                          handleLogout(false, 'kicked');
                      }
                  }).catch(() => handleLogout(false, 'kicked'));
              } else {
                  handleLogout(false, 'kicked');
              }
            }
          })
          .catch(err => {
            console.error("Heartbeat failed", err);
            // KHÔNG logout ở đây để tránh văng ra khi mạng chập chờn 1-2s
          });
      } catch (e) {
        console.error("Heartbeat error", e);
      }
    }, 15 * 1000);

    // 2. Active Logout on Tab Close
    const handleBeforeUnload = () => {
      const url = `${currentConfig.apiBase}/logout`;
      // Use URLSearchParams for application/x-www-form-urlencoded (CORS-safe simple request)
      const data = new URLSearchParams({ empno: userData.empno });

      // Use fetch with keepalive: true - The modern, reliable replacement for sendBeacon
      // It allows JSON and custom headers, and outlives the page unload
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: data,
        keepalive: true,
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, [isAuthenticated, userData]);

  // Logic khởi tạo App: Lấy Vân Tay và Auto-login (7 ngày)
  useEffect(() => {
    const initApp = async () => {
      try {
        // 1. Lấy mã định danh phần cứng (Fingerprint)
        const uid = await getBrowserFingerprint();
        setFingerprint(uid);

        // 2. Kiểm tra xem có Session cũ không
        const storedUser = localStorage.getItem("userData") || sessionStorage.getItem("userData");

        if (storedUser) {
          const user = JSON.parse(storedUser);

          // Ưu tiên dùng Refresh Token (mã 7 ngày) để lấy Session Token mới
          if (user.refreshToken && user.empno) {
            console.log("Found refresh token, attempting auto-login...");
            const result = await refreshAccess(user.empno, user.refreshToken, uid);

            if (result.allow) {
              const updatedUser = {
                ...user,
                token: result.session_token,
                fingerprint: uid
              };
              setUserData(updatedUser);
              localStorage.setItem("userData", JSON.stringify(updatedUser)); // Cập nhật session mới
              setIsAuthenticated(true);
            } else {
              console.warn("Auto-login attempt finished:", result.reason);
              // CHỈ XÓA DỮ LIỆU nếu server xác nhận Token hết hạn hoặc sai hoàn toàn
              if (result.reason === 'expired' || result.reason === 'invalid_refresh_token' || result.reason === 'refresh_token_expired') {
                  handleLogout(false); 
              }
              // Nếu là lỗi mạng (network_error) hoặc lỗi API tạm thời -> Giữ nguyên dữ liệu để lần sau F5 có thể vào lại
            }
          }
        }
      } catch (error) {
        console.error("App initialization error:", error);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    initApp();
  }, []);

  // Splash screen timer & Map Image Preloader
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    // Preload map images for instant floor switching
    const imagesToPreload = [];
    if (currentConfig.mapImage) imagesToPreload.push(currentConfig.mapImage);
    if (currentConfig.floors) {
      currentConfig.floors.forEach(f => {
        if (f.mapImage) imagesToPreload.push(f.mapImage);
      });
    }

    // Deduplicate and preload
    const uniqueImages = [...new Set(imagesToPreload)];
    uniqueImages.forEach(src => {
      const img = new Image();
      img.src = src;
    });

    return () => clearTimeout(timer);
  }, []);

  // Handle login success
  const handleLoginSuccess = (user, accessGranted = true) => {
    setUserData(user);
    setIsAuthenticated(true);
    setHasAccess(accessGranted);
  };

  // Handle logout
  const handleLogout = async (notifyServer = true, reason = '') => {
    // Chỉ gọi API Logout nếu được yêu cầu (đăng xuất chủ động hoặc bị đá)
    if (notifyServer && userData?.empno) {
      try {
        await fetch(`${currentConfig.apiBase}/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empno: userData.empno })
        });
      } catch (e) {
        console.error("Logout API failed", e);
      }
    }

    localStorage.removeItem("userData");
    sessionStorage.removeItem("userData");
    setUserData(null);
    setIsAuthenticated(false);

    // Nếu bị kick hoặc hết hạn, chuyển hướng kèm mã lỗi
    if (reason) {
      window.location.hash = `login?reason=${reason}`;
    }
  };

  // Show splash screen
  if (showSplash) {
    return <SplashScreen />;
  }

  // Checking authentication
  if (isCheckingAuth) {
    return null; // or a loading spinner
  }

  // Show home if authenticated and has access (TEMPORARILY BYPASSING AUTH FOR CH)
  // return (
  //   <>
  //     <Home
  //       userData={{ empno: 'DEV', name: 'Developer' }}
  //       onLogout={() => setIsAuthenticated(false)}
  //       onNavigateToManage={() => setCurrentScreen('manage')}
  //     />
  //     {currentScreen === 'manage' && (
  //       <ManageEvents onClose={() => setCurrentScreen('home')} />
  //     )}
  //   </>
  // );


  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Show unauthorized dialog OVER login screen if no access
  if (!hasAccess) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} />
        <UnauthorizedDialog userData={userData} onLogout={handleLogout} />
      </>
    );
  }

  // Show home if authenticated and has access
  return (
    <>
      <Home userData={userData} onLogout={handleLogout} onNavigateToManage={() => setCurrentScreen('manage')} />
      {currentScreen === 'manage' && (
        <ManageEvents onClose={() => setCurrentScreen('home')} />
      )}
    </>
  );

}
