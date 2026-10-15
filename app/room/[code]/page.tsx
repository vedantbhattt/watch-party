import { Suspense } from "react";
import RoomClient from "./RoomClient";

type RoomPageProps = { params: Promise<{ code: string }> };

async function RoomContent({ params }: RoomPageProps) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}

export default function RoomPage({ params }: RoomPageProps) {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#08090d] text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-violet-400/20 border-t-violet-400" /><p className="font-semibold">Loading watch room…</p></div></main>}>
      <RoomContent params={params} />
    </Suspense>
  );
}
