import { notFound } from "next/navigation";

import { requirePageUser } from "@/lib/session";
import { getUserBookById } from "@/lib/queries";
import { BookDetailForm } from "@/components/book-detail-form";

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser();
  const userBook = await getUserBookById(user.id, id);

  if (!userBook) notFound();

  return <BookDetailForm userBook={userBook} />;
}
