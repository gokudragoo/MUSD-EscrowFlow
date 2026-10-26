import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p className="amount text-[13px] font-medium text-mist-500">Error 404</p>
      <h1 className="mt-3 text-[30px] font-semibold text-white">This page does not exist</h1>
      <p className="mt-3 text-[15px] text-mist-300">The link may be mistyped, or the project may be private to its participants.</p>
      <div className="mt-8 flex gap-2">
        <Link href="/dashboard"><Button>Go to the dashboard</Button></Link>
        <Link href="/"><Button variant="outline">Home</Button></Link>
      </div>
    </div>
  );
}
