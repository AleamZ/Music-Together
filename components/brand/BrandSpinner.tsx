import Image from "next/image";
import logo from "@/public/logo.png";

export default function BrandSpinner({ label = "Đang tải…" }: { label?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Image src={logo} alt="" height={72} width={108} style={{ height: 72, width: "auto" }}
        className="animate-brand-pulse" preload={true} />
      <p className="font-cormorant text-burgundy">{label}</p>
    </main>
  );
}
