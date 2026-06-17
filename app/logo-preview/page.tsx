import PixelLogo from "@/components/brand/PixelLogo";

// Apply the cozy palette as inline CSS vars so PixelLogo (which reads
// var(--color-*)) renders in cozy colors here without touching <html>.
const COZY = {
  "--color-ink": "#5c4033",
  "--color-burgundy": "#d97c5a",
  "--color-gold": "#7fb069",
  "--color-green-vintage": "#6db5c9",
  "--color-cream": "#fbf3df",
} as React.CSSProperties;

const SIZES = [16, 24, 32, 48, 96, 160];

export default function LogoPreview() {
  return (
    <main style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif", background: "#f4e4c1", color: "#5c4033", ...COZY }}>
      <h1 style={{ margin: "0 0 6px" }}>🎮 Logo pixel boombox — preview</h1>
      <p style={{ margin: "0 0 20px", maxWidth: 640 }}>
        Bản vẽ lại (grid 24×15: tay cầm, 2 loa tròn có vành + tâm sáng, màn hình, núm + slider).
        Xem rồi báo: ổn chưa, cần chỉnh gì (loa to/nhỏ, màn hình, màu, bỏ tay cầm…). Trang này tách biệt, không ảnh hưởng app.
      </p>

      <h2 style={{ fontSize: 16 }}>Trên nền kem (cozy)</h2>
      <section style={{ display: "flex", gap: 28, alignItems: "flex-end", flexWrap: "wrap", margin: "8px 0 24px", padding: 18, border: "3px solid #5c4033", borderRadius: 8, background: "#fbf3df" }}>
        {SIZES.map((s) => (
          <div key={s} style={{ textAlign: "center" }}>
            <PixelLogo size={s} />
            <div style={{ fontSize: 11, marginTop: 6, color: "#9c7a52" }}>{s}px</div>
          </div>
        ))}
      </section>

      <h2 style={{ fontSize: 16 }}>Cạnh chữ (header) & trên nền tối</h2>
      <section style={{ ...COZY, display: "flex", gap: 16, alignItems: "center", padding: 18, borderRadius: 8, background: "#2a211a", color: "#fff" }}>
        <PixelLogo size={40} />
        <span style={{ fontSize: 22, fontWeight: "bold" }}>Music Together</span>
        <span style={{ marginLeft: "auto" }}><PixelLogo size={120} /></span>
      </section>

      <p style={{ marginTop: 20, color: "#9c7a52", fontSize: 13 }}>
        Khi bạn ưng, tôi thay vào logo thật (header/favicon/spinner) + chỉnh máy phát trong phòng cho khớp, rồi gỡ trang preview này.
      </p>
    </main>
  );
}
