import { notFound } from "next/navigation";

import { requireUser } from "@/lib/session";
import { getUserBookById } from "@/lib/queries";
import { BookDetailForm } from "@/components/book-detail-form";

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const userBook = await getUserBookById(user!.id, id);

  if (!userBook) notFound();

  return <BookDetailForm userBook={userBook} />;
}
