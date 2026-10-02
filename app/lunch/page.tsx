import type { Metadata } from "next";
import LunchCase from "@/features/lunch-case/LunchCase";
import "@/features/lunch-case/lunch-case.css";

export const metadata: Metadata = {
  title: "Trưa nay ăn gì?",
  description: "Mở hòm, quay món và để bữa trưa có chút bất ngờ.",
  icons: { icon: "/lunch/brand/favicon-cs-v2.png", apple: "/lunch/brand/apple-touch-icon-cs-v2.png" },
};

export default function LunchPage() {
  return <LunchCase />;
}
