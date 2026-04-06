import FingerprintJS from '@fingerprintjs/fingerprintjs';

/**
 * Lấy mã vân tay định danh duy nhất cho trình duyệt/máy tính này.
 * @returns {Promise<string>} - Mã Hash định danh
 */
export async function getBrowserFingerprint() {
    try {
        // Khởi tạo agent
        const fpPromise = FingerprintJS.load();
        const fp = await fpPromise;
        
        // Lấy kết quả định danh
        const result = await fp.get();
        
        // Trả về visitorId (đây là mã duy nhất)
        return result.visitorId;
    } catch (error) {
        console.error("Lỗi khi lấy Fingerprint:", error);
        // Fallback đơn giản nếu thư viện lỗi
        return "fallback-" + navigator.userAgent.length + "-" + window.screen.width;
    }
}
