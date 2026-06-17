import { Press_Start_2P, Pixelify_Sans } from "next/font/google";

// Preview-only fonts (subset latin; Vietnamese diacritics fall back per-glyph — see note in UI).
const pressStart = Press_Start_2P({ weight: "400", subsets: ["latin"] });
const pixelify = Pixelify_Sans({ subsets: ["latin"] });

type Player = "eq" | "handheld" | "console" | "radio";
interface Theme {
  key: string;
  name: string;
  vibe: string;
  font: string;
  bg: string;
  panel: string;
  text: string;
  muted: string;
  a1: string; // primary accent
  a2: string;
  a3: string;
  border: string;
  radius: number;
  player: Player;
  glow: boolean;
}

// The two themes to build (plus the existing "vinyl salon" default).
const THEMES: Theme[] = [
  {
    key: "cyber", name: "Cyber Tím (Neon)", vibe: "synthwave tím · theo ảnh keyboard", font: pressStart.style.fontFamily,
    bg: "#0a0812", panel: "#171326", text: "#e9e3ff", muted: "#9b8fd6",
    a1: "#ff3db4", a2: "#27e6ff", a3: "#8b5cf6", border: "#7c5cff", radius: 0, player: "eq", glow: true,
  },
  {
    key: "cozy", name: "Pixel Cozy", vibe: "Stardew · pastel ấm", font: pixelify.style.fontFamily,
    bg: "#f4e4c1", panel: "#fbf3df", text: "#5c4033", muted: "#9c7a52",
    a1: "#7fb069", a2: "#d97c5a", a3: "#6db5c9", border: "#5c4033", radius: 4, player: "radio", glow: false,
  },
];

function box(t: Theme, extra: React.CSSProperties = {}): React.CSSProperties {
  return { background: t.panel, border: `3px solid ${t.border}`, borderRadius: t.radius, boxShadow: t.glow ? `0 0 12px ${t.a1}66` : `4px 4px 0 ${t.border}`, ...extra };
}

function PlayerArt({ t }: { t: Theme }) {
  if (t.player === "eq") {
    return (
      <div style={box(t, { padding: 14, textAlign: "center" })}>
        <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "flex-end", height: 56 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span key={i} style={{ width: 8, background: i % 2 ? t.a2 : t.a1, animation: `eq 0.9s ${i * 0.08}s ease-in-out infinite`, height: 14 }} />
          ))}
        </div>
        <div style={{ marginTop: 10, color: t.a3, fontSize: 9 }}>▶ NOW PLAYING</div>
      </div>
    );
  }
  if (t.player === "handheld") {
    return (
      <div style={box(t, { padding: 12 })}>
        <div style={{ background: "#c4cfa1", border: `3px solid ${t.border}`, padding: "10px 8px", textAlign: "center", color: t.text, fontSize: 12 }}>
          ♪ ♫ ♪<br />Đĩa Than — Lo-fi
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, color: t.text }}>
          <span style={{ fontSize: 18 }}>✚</span>
          <span style={{ display: "flex", gap: 6 }}>
            <b style={{ background: t.a1, color: t.panel, padding: "2px 7px" }}>A</b>
            <b style={{ background: t.a1, color: t.panel, padding: "2px 7px" }}>B</b>
          </span>
        </div>
      </div>
    );
  }
  if (t.player === "console") {
    return (
      <div style={box(t, { padding: 14, display: "flex", alignItems: "center", gap: 12 })}>
        <div style={{ flex: 1, height: 44, background: `repeating-linear-gradient(90deg, ${t.a2} 0 4px, ${t.panel} 4px 8px)`, border: `2px solid ${t.border}` }} />
        <div style={{ color: t.a3, fontSize: 9, textAlign: "center" }}>♪<br />TRACK<br />01</div>
        <div style={{ flex: 1, height: 44, background: `repeating-linear-gradient(90deg, ${t.a2} 0 4px, ${t.panel} 4px 8px)`, border: `2px solid ${t.border}` }} />
      </div>
    );
  }
  return (
    <div style={box(t, { padding: 14, display: "flex", alignItems: "center", gap: 14 })}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: t.a3, border: `3px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>♪</div>
      <div style={{ color: t.text, fontSize: 14 }}>
        ((( đang phát )))<br />
        <span style={{ color: t.muted, fontSize: 12 }}>Cozy Radio · Lo-fi</span>
      </div>
    </div>
  );
}

function Btn({ t, children, fill }: { t: Theme; children: React.ReactNode; fill?: boolean }) {
  return (
    <span style={{ display: "inline-block", padding: "5px 10px", fontSize: 11,
      background: fill ? t.a1 : "transparent", color: fill ? t.panel : t.a1,
      border: `2px solid ${t.a1}`, borderRadius: t.radius }}>{children}</span>
  );
}

function ThemeDemo({ t }: { t: Theme }) {
  return (
    <section style={{ background: t.bg, color: t.text, fontFamily: t.font, padding: 22, border: `3px solid ${t.border}`, borderRadius: t.radius }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 16, color: t.a1, margin: 0 }}>{t.name}</h2>
        <span style={{ fontSize: 11, color: t.muted }}>{t.vibe}</span>
      </div>
      <div style={{ display: "flex", gap: 6, margin: "10px 0 16px" }}>
        {[t.bg, t.panel, t.a1, t.a2, t.a3].map((c) => (
          <span key={c} title={c} style={{ width: 26, height: 26, background: c, border: `2px solid ${t.border}`, borderRadius: t.radius }} />
        ))}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1.1fr 1fr" }}>
        {/* Left: members + chat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={box(t, { padding: 10 })}>
            <div style={{ fontSize: 11, color: t.a2, marginBottom: 6 }}>THÀNH VIÊN</div>
            {["Huy 👑", "Lan 🎧", "Minh"].map((m) => (
              <div key={m} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                <span style={{ width: 8, height: 8, background: t.a3 }} /> {m}
              </div>
            ))}
          </div>
          <div style={box(t, { padding: 10 })}>
            <div style={{ fontSize: 11, color: t.a2, marginBottom: 6 }}>TRÒ CHUYỆN (2)</div>
            <div style={{ fontSize: 12 }}><b style={{ color: t.a1 }}>Lan:</b> nhạc hay quá</div>
            <div style={{ fontSize: 12 }}><b style={{ color: t.a1 }}>Huy:</b> chuẩn bài 🔥</div>
            <div style={{ ...box(t, { padding: "5px 8px", marginTop: 8, boxShadow: "none" }), fontSize: 11, color: t.muted }}>Nhắn gì đó…</div>
          </div>
        </div>

        {/* Center: player + reactions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: t.a2 }}>MÁY PHÁT NHẠC</div>
          <PlayerArt t={t} />
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Btn t={t} fill>▶ Phát</Btn><Btn t={t}>⏭ Skip</Btn>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", fontSize: 18 }}>❤️ 😂 🔥 👏 🎉</div>
        </div>

        {/* Right: queue */}
        <div style={box(t, { padding: 10 })}>
          <div style={{ fontSize: 11, color: t.a2, marginBottom: 6 }}>HÀNG ĐỢI · 3 bài</div>
          {["đưa em về nhàa", "Gặp Lại — Binz", "Lạ Lùng — Vũ"].map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
              <span style={{ width: 30, height: 20, background: [t.a1, t.a2, t.a3][i], border: `2px solid ${t.border}` }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ThemesPreview() {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 26, fontFamily: "ui-sans-serif, system-ui" }}>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes eq{0%,100%{height:14px}50%{height:52px}}" }} />
      <header>
        <h1 style={{ fontSize: 24, margin: "0 0 6px" }}>🎮 2 theme sẽ dựng</h1>
        <p style={{ color: "#555", margin: 0 }}>
          <b>Cyber Tím (Neon)</b> — synthwave tím theo ảnh keyboard bạn gửi (nền tím-đen, neon magenta + cyan, viền
          phát sáng, máy phát = cột equalizer). Và <b>Pixel Cozy</b> — pastel ấm kiểu Stardew. Cả hai sẽ là tuỳ chọn
          trong nút đổi theme, song song theme &quot;vinyl salon&quot; hiện tại. Trang preview tách biệt, không ảnh hưởng app.
          Lưu ý: font pixel ở đây dùng bộ ký tự latin nên dấu tiếng Việt có thể rơi về font dự phòng; khi dựng thật tôi
          sẽ để <b>tiêu đề pixel + chữ thân readable</b> cho tiếng Việt sắc nét.
        </p>
      </header>
      {THEMES.map((t) => <ThemeDemo key={t.key} t={t} />)}
      <footer style={{ color: "#888", fontSize: 13 }}>Chọn xong, tôi dựng theme đó vào hệ thống chọn-theme (data-theme + nút đổi theme), giữ nguyên toàn bộ logic.</footer>
    </main>
  );
}
