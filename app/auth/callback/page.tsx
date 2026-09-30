import AuthCallback from "@/components/auth/AuthCallback";

export const metadata = { title: "Xác nhận email — Music Together" };

/** Where a confirmation mail lands (sign-up, email link, email change): see components/auth/AuthCallback.tsx. */
export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuthCallback params={await searchParams} />;
}
