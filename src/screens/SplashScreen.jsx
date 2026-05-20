// src/screens/SplashScreen.jsx
import Lottie from "lottie-react";
import { useTranslation } from "react-i18next";
import logoAnim from "../assets/lotties/LogoAppAnimation.json";
import logoAnimCH from "../assets/lotties/LogoAppCHAnimation.json";
import { currentConfig } from "../config/factoryConfig";

export default function SplashScreen() {
  const { t } = useTranslation("common");

  return (
    <div className="w-screen h-screen bg-white flex flex-col items-center justify-center text-slate-900">
      {/* Logo = 1/6 chiều cao màn hình */}
      <div
        className="relative flex items-center justify-center"
        style={{
          height: "16.6vh",
          width: "16.6vh",
        }}
      >
        <div
          className="absolute inset-0 rounded-full blur-2xl opacity-50"
          style={{
            background:
              "radial-gradient(circle at center, #ff8b3a 0%, transparent 70%)",
          }}
        />
        <Lottie
          animationData={currentConfig.factoryId === 'ch' ? logoAnimCH : logoAnim}
          loop
          autoplay
          className="relative w-full h-full"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            pointerEvents: "none",
          }}
          rendererSettings={{
            preserveAspectRatio: "xMidYMid meet",
          }}
        />
      </div>

      {/* Tên app */}
      <h1
        className="
          mt-6 
          font-semibold 
          tracking-[0.25em] 
          uppercase 
          text-center
        "
        style={{
          color: currentConfig.factoryId === 'ch' ? "#046836" : "#ff8b3a",
          fontSize: "clamp(24px, 4vh, 36px)",
        }}
      >
        {t("appName")}
      </h1>

      {/* Subtitle */}
      <p className="mt-3 text-xs md:text-sm text-slate-500 tracking-wide text-center">
        {t("splash.subtitle")}
      </p>
    </div>
  );
}
