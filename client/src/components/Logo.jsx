import logoSvg from "../logo.svg";

export default function Logo({ size = 40, withText = false, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={logoSvg}
        alt="ZedAI - AI Yemen"
        style={{ width: size, height: size, objectFit: "contain" }}
        className="shrink-0"
      />
      {withText && (
        <div className="flex flex-col leading-tight">
          <span className="font-bold text-sm sm:text-base bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            ZedAI
          </span>
          <span className="text-[10px] text-gray-400 tracking-wider">AI YEMEN</span>
        </div>
      )}
    </div>
  );
}
