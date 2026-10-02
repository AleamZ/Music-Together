import type { Viewport } from "next";
import RoomClient from "./RoomClient";

// The game room: fit the phone's screen edge to edge (the HUD pads by the safe-area insets) and no accidental pinch
// zoom while playing with the touch joystick.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code} />;
}
