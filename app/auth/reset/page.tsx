import ResetPassword from "@/components/auth/ResetPassword";

export const metadata = { title: "Đặt lại mật khẩu — Music Together" };

/** Where a password-reset mail lands: see components/auth/ResetPassword.tsx. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ResetPassword params={await searchParams} />;
}
